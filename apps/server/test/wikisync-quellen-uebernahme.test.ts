import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { runWikiUebernehmenJob, runWikiZuruecknehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { importSources } from "../src/migration/sources-import.ts";
import { leseVorkommen } from "../src/inhalte/vorkommen-lesen.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { KATALOG_FELD, adressSchluessel, platzhalterId, verwendungsFeld } from "../src/wiki/abgleich/quellen.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { ID, legeGebieteAn, legeOrteAn, raeumeAb } from "./support/wikisync-welt.ts";

/**
 * Die Quellen im WikiSync (WI-0253, Scheibe Quellen) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (alle Vorlagen unter `src/db/`). Die Jobs-Rolle rechnet und
 * schreibt, die Welt ist erfunden: ein Ort und ein Herrschaftsgebiet mit ihren Artikeln, Produktseiten, eine Weiterleitung, ein Katalog und Verknüpfungen in allen Zuständen.
 * 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder in eine Umgebung; keiner fragt das Wiki.
 *
 * - **Vorschau:** Die Quelle folgt aus dem Linktitel (Weiterleitung aufgelöst) über `wikipub:` + Legacys Slug oder `url:<sha256>`; die Zeile gehört der Quelle, ihr Feld ist der Träger;
 *   „neu zitiert“ wird angelegt (eine fehlende Katalogquelle mit eigener Zeile), „nicht mehr zitiert“ still gelegt (nur mit belegter Wiki-Herkunft), „ohne Produktseite“ bleibt Befund.
 * - **Übernahme:** Art, Seiten und Notiz einer Verknüpfung des Wikis und der Titel einer Quelle, die nicht der Redaktion gehört, an zwei Trägerarten; neue Verknüpfungen (WI-0253 §21), die
 *   fehlende Quelle mit; das Stilllegen (nie Löschen) einer nicht mehr genannten; das Etikett der Träger wird neu gerechnet. Eine Verknüpfung ohne belegte Herkunft, eine der Redaktion,
 *   ein Tombstone und die Quelle der Redaktion bleiben; Art der Quelle, „offiziell“, Adresse, Lizenz und Korpus bestehender Quellen bleiben. Eine Operation der Quelle `wikisync`, keine
 *   Ableitung, der zweite Lauf ohne Änderung.
 * - **Rücknahme:** stellt her, nur wo der Istwert noch der der Übernahme ist und die Verknüpfung dem Wiki gehört: Angelegtes wird still gelegt, Still-Gelegtes lebt wieder auf, eine angelegte
 *   Quelle ohne aktive Verknüpfung wird still gelegt; die nächste Nennung belebt sie wieder.
 * - **Legacy-Zug:** Gehören die Quellen dem WikiSync, lässt der Schritt I18 sie aus. **Rechte:** Die Jobs-Rolle legt an, legt still, rechnet den Kanon neu; sie löscht nur dort.
 */

const ENV = "wikisyncquelle";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const ADRESSE_FLUSS = "https://www.f-shop.de/search?sSearch=12011";
const ADRESSE_HEFT = "https://www.f-shop.de/search?sSearch=777";

const produkt = (titel: string, shop?: string, extra = ""): string =>
    `{{Infobox Produkt\n|Titel=${titel}\n|Art=Quellenband\n${shop === undefined ? "" : `|Direktlinks={{F-Shop|PID=${shop}}}\n`}${extra}}}`;

const DUMP: FixtureSeite[] = [
    {
        titel: "Gareth",
        ns: 0,
        text:
            "{{Infobox Siedlung\n|Name=Gareth\n|Einwohner=7.400\n}}\nGareth ist die Hauptstadt.\n== Publikationen ==\n" +
            "=== Ausführliche Quellen ===\n* [[Am Großen Fluss]] Seite 40, '''145''' <small>(Zerstörung)</small>\n* [[Reich des Horas]] Seite 3\n" +
            "=== Ergänzende Quellen ===\n* [[Die Redaktionsquelle]] Seite 6\n* [[Tombstone Buch]] Seite 8\n* [[Neues Buch]] Seite 12\n* [[Zweiter Band]] Seite 1\n" +
            "* [[Neue Adresse]] Seite 2\n* [[Heft Zwei]] Seite 4\n=== Erwähnungen ===\n* [[Der Rabenkrieg]] Seite 7\n* [[Archiv der Kräuter]] Seite 5\n== Weblinks ==\n* [[Nicht gemeint]] Seite 9\n",
    },
    {
        titel: "Herzogtum Weiden",
        ns: 0,
        text: "{{Infobox Staat\n|Name=Herzogtum Weiden\n}}\nWeiden.\n== Publikationen ==\n=== Ergänzende Quellen ===\n* [[Am Großen Fluss]] Seite 12\n",
    },
    { titel: "Am Großen Fluss", ns: 0, text: produkt("Am Großen Fluss", "12011") },
    { titel: "Der Rabenkrieg", ns: 0, text: produkt("Der Rabenkrieg") },
    { titel: "Das Horasreich", ns: 0, text: produkt("Das Horasreich") },
    { titel: "Reich des Horas", ns: 0, weiterleitung: "Das Horasreich" },
    { titel: "Die Redaktionsquelle", ns: 0, text: produkt("Die Redaktionsquelle") },
    { titel: "Tombstone Buch", ns: 0, text: produkt("Tombstone Buch") },
    { titel: "Neues Buch", ns: 0, text: produkt("Neues Buch") },
    { titel: "Zweiter Band", ns: 0, text: produkt("Zweiter Band") },
    { titel: "Neue Adresse", ns: 0, text: produkt("Neue Adresse", "888") },
    // Zwei Produktseiten teilen sich die Shop-Adresse (ein Heft und das Abenteuer darin): Ihre Quelle hat keinen eindeutigen Titel.
    { titel: "Aventurischer Bote Nr. 1", ns: 0, text: produkt("Aventurischer Bote Nr. 1", "777") },
    { titel: "Heft Zwei", ns: 0, text: produkt("Heft Zwei", "777") },
    // Eine Seite, die keine Produktseite ist.
    { titel: "Archiv der Kräuter", ns: 0, text: "{{Infobox Region\n|Name=Archiv\n}}\nKeine Produktseite." },
    // Der Artikel eines Eintrags der Vorkommen (WI-0254 §12): Der Lauf legt nur seine Zitate ab.
    {
        titel: "Tatzelwurm",
        ns: 0,
        text:
            "{{Infobox Tier\n|Name=Tatzelwurm\n}}\nEin Drache.\n== Publikationen ==\n=== Ausführliche Quellen ===\n* [[Der Rabenkrieg]] Seite 7 <small>(Krieg)</small>\n" +
            "=== Ergänzende Quellen ===\n* [[Am Großen Fluss]] Seite 12\n=== Erwähnungen ===\n* [[Neues Buch]] Seite 2\n* [[Archiv der Kräuter]] Seite 5\n",
    },
];

function kontext(input: Record<string, unknown>, jobPublicId: string = randomUUID()): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: jobPublicId, leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    };
}

interface Quelle {
    titel: string;
    schluessel?: string;
    url?: string;
    art?: string;
    system?: "legacy" | "editor";
    korpus?: string;
    attribution?: string;
}

describeWithCluster("WikiSync Quellen: Vorschau, Übernahme und Rücknahme der Publikationen (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let umgebung: NodeJS.ProcessEnv;
    let ablage: VorschauAblage;
    const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;
    const q: Record<string, string> = {};

    const jobs = (): Database => cluster!.jobs;
    const admin = (): Database => cluster!.admin;
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
    const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);

    async function vorschau(): Promise<number> {
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche: ["quelle"] }), {
            environment: umgebung,
            ladeZuweisungen: () => ladeZuweisungen(jobs()),
            ladeTafel: async () => {
                const stand = await leseNamespaceTafel(jobs());
                return {
                    revision: stand.revision,
                    quelle: stand.revision === null ? "vorgabe" : "datenbank",
                    namensraeume: stand.namensraeume,
                };
            },
            ablage,
        });
        return (ergebnis["lauf"] as { id: number }).id;
    }

    type Ergebnis = {
        bereiche: {
            status: string;
            grund?: string;
            operationId?: string | null;
            zahlen?: Record<string, number>;
            uebernahme: number | null;
        }[];
    };
    const uebernehmen = async (): Promise<Ergebnis> =>
        (await runWikiUebernehmenJob(kontext({ bereiche: ["quelle"] }), {
            environment: einsatz,
            mitDatenbank: (arbeit) => arbeit(jobs()),
        })) as never;

    async function zuruecknehmen(
        lauf: number,
        uebernahme: number,
    ): Promise<{ status: string; zahlen: Record<string, number> }> {
        const [job] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue('wiki_zuruecknehmen', 1::smallint, 'aventuria', 'cli:test', '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
        return (await runWikiZuruecknehmenJob(kontext({ bereich: "quelle", lauf, uebernahme }, job!.public_id), {
            environment: einsatz,
            mitDatenbank: (arbeit) => arbeit(jobs()),
        })) as never;
    }

    async function legeQuelleAn(name: string, teil: Quelle): Promise<void> {
        const url = teil.url ?? null;
        const schluessel = url === null ? (teil.schluessel as string) : adressSchluessel(url);
        const [zeile] = await admin()<{ id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, attribution, corpus_key, source_system)
            VALUES (${schluessel}, 'final', ${url}, ${teil.titel}, ${teil.art ?? "sonstiges"}, TRUE, ${teil.attribution ?? null}, ${teil.korpus ?? null},
                    ${teil.system ?? "legacy"})
            RETURNING public_id::text AS id
        `;
        q[name] = zeile!.id;
    }

    let position = 0;
    async function verknuepfe(
        traeger: "place" | "territory",
        id: string,
        quelle: string,
        teil: {
            art: string | null;
            seiten?: string | null;
            notiz?: string | null;
            herkunft?: "wiki_publication" | "manual" | null;
            zustand?: "active" | "retired" | "suppressed";
            system?: "legacy" | "editor";
            stillgelegtVon?: "import" | "editor";
        },
    ): Promise<void> {
        const zustand = teil.zustand ?? "active";
        const aktiv = zustand === "active";
        await admin().unsafe(
            `INSERT INTO ${traeger}_source (${traeger}_id, source_id, reference_kind, pages, note, legacy_origin, position, state, is_active, retired_at, retired_origin, source_system)
             SELECT t.id, f.id, $3::text, $4::text, $5::text, $6::text, $7::int, $8::text, $9::boolean, $10::timestamptz, $11::text, $12::text
               FROM ${traeger} t, feature_source f WHERE t.public_id = $1::uuid AND f.public_id = $2::uuid`,
            [
                id,
                quelle,
                teil.art,
                teil.seiten ?? null,
                teil.notiz ?? null,
                teil.herkunft ?? null,
                position++,
                zustand,
                aktiv,
                aktiv ? null : new Date().toISOString(),
                aktiv ? null : (teil.stillgelegtVon ?? "editor"),
                teil.system ?? "legacy",
            ] as never[],
        );
    }

    /**
     * Die Welt: Gareth (Ort) und das Herzogtum Weiden (Gebiet) mit ihren Artikeln; der Katalog und die Verknüpfungen in allen Zuständen.
     * - Am Großen Fluss: Titel veraltet (Wiki: „Am Großen Fluss“); an Gareth ergänzend 40 (wiki → ausführlich 40, 145, Notiz), an Weiden erwähnt (wiki → ergänzend 12): zwei Träger.
     * - Das Horasreich (über die Weiterleitung „Reich des Horas“): ergänzend 3 OHNE belegte Herkunft (Wiki: ausführlich) → Befund.
     * - Die Redaktionsquelle: Quelle der Redaktion mit eigenem Titel, Verknüpfung der Redaktion → bleibt.
     * - Tombstone Buch: unterdrückt. Der Rabenkrieg: stimmt. Alt Zitat: wiki-eigen, der Artikel nennt sie nicht mehr.
     * - Zweiter Band: Quelle ohne Verknüpfung (neu zitiert). Neues Buch: nicht im Katalog. Neue Adresse: im Katalog noch URL-los.
     * - Aventurischer Bote Nr. 1 und Heft Zwei teilen eine Shop-Adresse.
     */
    async function neueWelt(): Promise<void> {
        await raeumeAb(admin());
        await admin()`TRUNCATE feature_source, source_corpus RESTART IDENTITY CASCADE`;
        await admin()`
            INSERT INTO source_corpus (corpus_key, label, form, source_type, is_official)
            VALUES ('f-shop.de', 'F-Shop', 'belegstelle', 'regionalspielhilfe', TRUE)
        `;
        await legeOrteAn(admin());
        await legeGebieteAn(admin());
        await legeQuelleAn("fluss", {
            titel: "Am Grossen Fluss alt",
            url: ADRESSE_FLUSS,
            art: "regionalspielhilfe",
            korpus: "f-shop.de",
            attribution: "F-Shop",
        });
        await legeQuelleAn("raben", { titel: "Der Rabenkrieg", schluessel: "wikipub:der-rabenkrieg", art: "roman" });
        await legeQuelleAn("horas", { titel: "Das Horasreich", schluessel: "wikipub:das-horasreich" });
        await legeQuelleAn("redaktion", {
            titel: "Meine Redaktionsquelle",
            schluessel: "wikipub:die-redaktionsquelle",
            system: "editor",
        });
        await legeQuelleAn("tombstone", { titel: "Tombstone Buch", schluessel: "wikipub:tombstone-buch" });
        await legeQuelleAn("alt", { titel: "Alt Zitat", schluessel: "wikipub:alt-zitat" });
        await legeQuelleAn("zweiter", { titel: "Zweiter Band", schluessel: "wikipub:zweiter-band" });
        await legeQuelleAn("neueAdresse", { titel: "Neue Adresse", schluessel: "wikipub:neue-adresse" });
        await legeQuelleAn("heft", { titel: "Aventurischer Bote Nr. 1", url: ADRESSE_HEFT });
        position = 0;
        const gareth = ID.gareth;
        const weiden = ID.weiden;
        await verknuepfe("place", gareth, q["fluss"]!, {
            art: "ergaenzend",
            seiten: "40",
            herkunft: "wiki_publication",
        });
        await verknuepfe("territory", weiden, q["fluss"]!, { art: "erwaehnung", herkunft: "wiki_publication" });
        await verknuepfe("place", gareth, q["raben"]!, {
            art: "erwaehnung",
            seiten: "7",
            herkunft: "wiki_publication",
        });
        await verknuepfe("place", gareth, q["horas"]!, { art: "ergaenzend", seiten: "3" });
        await verknuepfe("place", gareth, q["redaktion"]!, { art: "ergaenzend", seiten: "5", system: "editor" });
        await verknuepfe("place", gareth, q["tombstone"]!, {
            art: "erwaehnung",
            herkunft: "wiki_publication",
            zustand: "suppressed",
        });
        await verknuepfe("place", gareth, q["alt"]!, { art: "erwaehnung", seiten: "2", herkunft: "wiki_publication" });
        await admin()`
            INSERT INTO place_canon (place_id, canon) SELECT id, 'official' FROM place WHERE public_id = ${gareth}::uuid
        `;
    }

    /** Der ganze Stand der Quellen, so wie ihn ein Leser sieht (ohne Zeitstempel der Verknüpfungen, die der Test eigens prüft). */
    const quellenStand = async (): Promise<unknown[]> =>
        wert(`SELECT public_id::text, source_key, url, title, source_type, is_official, license_statement, license_key, attribution, corpus_key, source_system,
                     is_active, retired_origin, revision::int AS revision
                FROM feature_source ORDER BY public_id`);
    const verknuepfungen = async (): Promise<Record<string, unknown>[]> =>
        wert(
            `SELECT 'place' AS traeger, t.public_id::text AS traeger_id, f.public_id::text AS quelle, l.reference_kind, l.pages, l.note, l.legacy_origin,
                    l.position, l.state, l.is_active, l.retired_origin, l.source_system, l.updated_at::text AS updated_at
               FROM place_source l JOIN place t ON t.id = l.place_id JOIN feature_source f ON f.id = l.source_id
             UNION ALL
             SELECT 'territory', t.public_id::text, f.public_id::text, l.reference_kind, l.pages, l.note, l.legacy_origin, l.position, l.state, l.is_active,
                    l.retired_origin, l.source_system, l.updated_at::text
               FROM territory_source l JOIN territory t ON t.id = l.territory_id JOIN feature_source f ON f.id = l.source_id
              ORDER BY 1, 2, 3`,
        );
    const verwendung = async (traeger: string, quelle: string): Promise<Record<string, unknown>> => {
        const zeile = (await verknuepfungen()).find(
            (kandidat) => kandidat["traeger_id"] === traeger && kandidat["quelle"] === quelle,
        );
        if (zeile === undefined) throw new Error(`Keine Verknüpfung ${traeger}/${quelle}`);
        return zeile;
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-quellen");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
        umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekte(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeWikisyncBereiche: () => wikisyncBereiche(j),
            schreibe: (eingabe) => schreibeLauf(j, eingabe),
            schreibeFehllauf: (eingabe, fehler) => schreibeFehllauf(j, eingabe, fehler),
            ausloeser: () => Promise.resolve("jobs-cli"),
        };
    }, 240_000);
    afterAll(async () => {
        await ordner?.weg();
        await cluster?.stop();
    }, 60_000);

    type Zeile = {
        objekt: string | null;
        objekt_name: string | null;
        feld: string;
        artikel: string | null;
        alt: string | null;
        neu: string | null;
        eigentuemer: string;
        wirkung: string;
        status: string;
        grund: string | null;
        objekte: number;
        objekt_art: string;
    };
    const zeilen = (laufId: number): Promise<Zeile[]> =>
        wert<Zeile>(
            `SELECT objekt_id::text AS objekt, objekt_name, feld, artikel, alt, neu, eigentuemer, wirkung, status, grund, objekte, objekt_art
               FROM wikisync_lauf_zeile WHERE lauf_id = ${String(laufId)} AND bereich = 'quelle' ORDER BY position`,
        );

    const kanonVon = async (ort: string): Promise<Record<string, unknown> | undefined> =>
        (
            await wert<Record<string, unknown>>(
                `SELECT canon, designator_type, designator_count, derived_from, source_system
                   FROM place_canon WHERE place_id = (SELECT id FROM place WHERE public_id = '${ort}')`,
            )
        )[0];
    const quelleNachSchluessel = async (schluessel: string): Promise<Record<string, unknown> | undefined> =>
        (
            await wert<Record<string, unknown>>(
                `SELECT public_id::text AS id, source_key, identity_state, url, title, source_type, is_official, license_statement, license_key, attribution, corpus_key,
                        source_system, is_active, retired_at IS NOT NULL AS hat_still, retired_origin, revision::int AS revision
                   FROM feature_source WHERE source_key = '${schluessel}'`,
            )
        )[0];
    const ohneZeit = (zeilen: Record<string, unknown>[]): Record<string, unknown>[] =>
        zeilen.map((zeile) =>
            Object.fromEntries(Object.entries(zeile).filter(([schluessel]) => schluessel !== "updated_at")),
        );
    const operationen = (): Promise<number> => zahl(`SELECT count(*)::int AS n FROM map_operation`);
    const NEUES_BUCH = "wikipub:neues-buch";

    it("🔴 Vorschau: jede Publikation über ihre Quelle (Weiterleitung aufgelöst, wikipub: und url:), die Zeile gehört der Quelle und ihr Feld ist der Träger; neu zitiert wird angelegt (auch die fehlende Quelle), nicht mehr zitiert still gelegt, nur mit belegter Herkunft; sonst Befund", async () => {
        await neueWelt();
        const vorherStand = await quellenStand();
        const vorherVerknuepfungen = await verknuepfungen();
        const laufId = await vorschau();
        const [lauf] = await wert<{ zahlen: Record<string, Record<string, number>> }>(
            `SELECT zahlen FROM wikisync_lauf WHERE id = ${String(laufId)}`,
        );
        // Ein Ort und ein Gebiet haben ihren Artikel (Gareth, Weiden); die übrigen Träger der Welt fehlen im Dump.
        expect(lauf!.zahlen["quelle"]).toMatchObject({
            objekte: 10,
            mitAdresse: 10,
            gefunden: 2,
            nichtImDump: 8,
            uebernommen: 8,
            eigen: 2,
            angelegt: 3,
            stillgelegt: 1,
            quellenAngelegt: 1,
        });

        const alle = await zeilen(laufId);
        const von = (name: string): Zeile[] => alle.filter((zeile) => zeile.objekt_name === name);
        const verwendungenVon = (name: string): Zeile[] =>
            von(name).filter((zeile) => zeile.feld.startsWith("verwendung_"));
        const titelVon = (name: string): Zeile[] => von(name).filter((zeile) => zeile.feld === "title");
        const gareth = verwendungsFeld("place", ID.gareth);
        const weiden = verwendungsFeld("territory", ID.weiden);

        // Am Großen Fluss: zwei Verwendungen des Wikis (Ort und Gebiet) und der Titel, der beide Träger trifft.
        expect(
            verwendungenVon("Am Grossen Fluss alt").map((zeile) => [zeile.feld, zeile.artikel, zeile.alt, zeile.neu]),
        ).toEqual([
            [gareth, "Gareth", "ergaenzend | 40 | ", "ausfuehrlich | 40, 145 | Zerstörung"],
            [weiden, "Herzogtum Weiden", "erwaehnung |  | ", "ergaenzend | 12 | "],
        ]);
        expect(titelVon("Am Grossen Fluss alt")).toEqual([
            expect.objectContaining({
                objekt: q["fluss"],
                artikel: "Am Großen Fluss",
                alt: "Am Grossen Fluss alt",
                neu: "Am Großen Fluss",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
                status: "geaendert",
                objekte: 2,
                objekt_art: "source",
            }),
        ]);
        // Ohne belegte Herkunft (Legacys Export E1+ fehlt): ein Befund, auch wenn die Quelle über eine Weiterleitung gefunden wurde.
        expect(verwendungenVon("Das Horasreich")).toEqual([
            expect.objectContaining({
                eigentuemer: "unbekannt",
                wirkung: "befund",
                status: "geaendert",
                alt: "ergaenzend | 3 | ",
                neu: "ausfuehrlich | 3 | ",
            }),
        ]);
        // Die Redaktion: Verknüpfung und Titel bleiben eigen.
        expect(verwendungenVon("Meine Redaktionsquelle")).toEqual([
            expect.objectContaining({ eigentuemer: "manual", wirkung: "eigen", status: "geaendert" }),
        ]);
        expect(titelVon("Meine Redaktionsquelle")).toEqual([
            expect.objectContaining({
                eigentuemer: "manual",
                wirkung: "eigen",
                alt: "Meine Redaktionsquelle",
                neu: "Die Redaktionsquelle",
            }),
        ]);
        // Ein Tombstone lebt nie wieder auf.
        expect(verwendungenVon("Tombstone Buch")).toEqual([
            expect.objectContaining({
                eigentuemer: "unterdrueckt",
                wirkung: "befund",
                status: "unterdrueckt",
                alt: null,
            }),
        ]);
        // Der Rabenkrieg stimmt: keine Zeile, auch kein Titel.
        expect(von("Der Rabenkrieg")).toEqual([]);
        // Neu zitiert: Die Quelle des Katalogs bekommt eine Verknüpfung.
        expect(verwendungenVon("Zweiter Band")).toEqual([
            expect.objectContaining({
                objekt: q["zweiter"],
                status: "neu",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
                alt: null,
                neu: "ergaenzend | 1 | ",
                grund: "Neu zitiert; die Verknüpfung wird angelegt",
            }),
        ]);
        // Zwei Produktseiten teilen die Shop-Adresse: „Heft Zwei“ wird an die gemeinsame Quelle verknüpft, ihr Titel ist nicht eindeutig (Befund).
        expect(verwendungenVon("Aventurischer Bote Nr. 1")).toEqual([
            expect.objectContaining({
                objekt: q["heft"],
                status: "neu",
                wirkung: "uebernommen",
                neu: "ergaenzend | 4 | ",
            }),
        ]);
        expect(titelVon("Aventurischer Bote Nr. 1")).toEqual([
            expect.objectContaining({
                status: "mehrdeutig",
                wirkung: "befund",
                neu: null,
                grund: expect.stringContaining("Shop-Adresse"),
            }),
        ]);
        // Fehlt die Quelle im Katalog, steht eine Zeile für die Quelle (unter der Platzhalter-Kennung) und eine für die Verknüpfung.
        const platzhalter = platzhalterId(NEUES_BUCH);
        expect(
            von("Neues Buch").map((zeile) => [zeile.feld === KATALOG_FELD ? "katalog" : "verwendung", zeile.objekt]),
        ).toEqual([
            ["verwendung", platzhalter],
            ["katalog", platzhalter],
        ]);
        expect(von("Neues Buch").find((zeile) => zeile.feld === KATALOG_FELD)).toMatchObject({
            neu: `${NEUES_BUCH} | quellenband | ja | `,
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            status: "neu",
            objekte: 1,
            artikel: "Neues Buch",
        });
        // „Neue Adresse“ trägt im Katalog noch die URL-lose Kennung: ein Befund.
        expect(verwendungenVon("Neue Adresse")).toEqual([
            expect.objectContaining({
                objekt: q["neueAdresse"],
                status: "neu",
                wirkung: "befund",
                grund: expect.stringContaining("Shop-Adresse"),
            }),
        ]);
        // Nicht mehr zitiert, belegte Wiki-Herkunft: wird still gelegt.
        expect(verwendungenVon("Alt Zitat")).toEqual([
            expect.objectContaining({
                objekt: q["alt"],
                status: "zu_entfernen",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
                alt: "erwaehnung | 2 | ",
                neu: null,
            }),
        ]);
        // Ein Linkziel, das keine Produktseite ist.
        expect(alle.filter((zeile) => zeile.feld === "ohne_produktseite")).toEqual([
            expect.objectContaining({
                objekt: null,
                objekt_name: "Archiv der Kräuter",
                objekte: 1,
                status: "neu",
                wirkung: "befund",
            }),
        ]);

        // 🔴 Eine Vorschau schreibt nichts in die Fachtafeln.
        expect(await quellenStand()).toEqual(vorherStand);
        expect(await verknuepfungen()).toEqual(vorherVerknuepfungen);
    });

    it("🔴 Übernahme und Rücknahme: Werte folgen dem Wiki, neue Verknüpfungen entstehen (die fehlende Quelle mit), eine nicht mehr genannte wird still gelegt, der Kanon der Träger wird neu gerechnet; Redaktion, Tombstone und Unbelegtes bleiben; zurück geht alles, und die nächste Nennung belebt es wieder", async () => {
        await neueWelt();
        // Das Etikett von Gareth steht auf einem alten Stand; die Übernahme rechnet es neu.
        await admin()`UPDATE place_canon SET canon = 'unofficial' WHERE place_id = (SELECT id FROM place WHERE public_id = ${ID.gareth}::uuid)`;
        const laufId = await vorschau();
        const stand = await quellenStand();
        const link = await verknuepfungen();
        const anzahl = async (): Promise<number[]> => [
            await zahl(`SELECT count(*)::int AS n FROM feature_source`),
            await zahl(`SELECT count(*)::int AS n FROM place_source`),
            await zahl(`SELECT count(*)::int AS n FROM territory_source`),
        ];
        const mengen = await anzahl();

        const ergebnis = await uebernehmen();
        expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
        // Der Titel und sechs Schritte der Verwendungen: zwei Änderungen, zwei neue Verknüpfungen, ein Stilllegen, eine neue Quelle.
        expect(ergebnis.bereiche[0]!.zahlen).toMatchObject({
            felder: 7,
            liste: 6,
            angelegt: 3,
            stillgelegt: 1,
            quellenAngelegt: 1,
        });
        const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;

        const alsMap = (zeilen: unknown[]): Map<string, Record<string, unknown>> =>
            new Map((zeilen as Record<string, unknown>[]).map((zeile) => [String(zeile["public_id"]), zeile]));
        const vorher = alsMap(stand);
        const nachher = alsMap(await quellenStand());
        // Der Titel der Quelle folgt dem Wiki; Schlüssel, Adresse, Art, „offiziell“, Lizenz, Namensnennung und Korpus bleiben.
        expect(nachher.get(q["fluss"]!)).toEqual({
            ...vorher.get(q["fluss"]!),
            title: "Am Großen Fluss",
            revision: (vorher.get(q["fluss"]!)!["revision"] as number) + 1,
        });
        // Die Quellen, an deren Verknüpfungen etwas geschah, zählen ihre Revision genau einmal (ein offener Entwurf bekommt 409); sonst ändert sich an ihnen nichts.
        for (const name of ["zweiter", "heft", "alt"] as const) {
            expect(nachher.get(q[name]!), name).toEqual({
                ...vorher.get(q[name]!),
                revision: (vorher.get(q[name]!)!["revision"] as number) + 1,
            });
        }
        // 🔴 Jede andere Quelle, auch die der Redaktion, ist unberührt, samt Revision.
        for (const [id, zeile] of vorher) {
            if (![q["fluss"], q["zweiter"], q["heft"], q["alt"]].includes(id))
                expect(nachher.get(id), id).toEqual(zeile);
        }
        // Die fehlende Quelle ist angelegt: wie Legacy (Schlüssel, Titel, Art der Produktseite, offiziell, keine Adresse), Herkunft wikisync, nichts stillgelegt.
        const neu = (await quelleNachSchluessel(NEUES_BUCH))!;
        expect(neu).toMatchObject({
            source_key: NEUES_BUCH,
            identity_state: "final",
            url: null,
            title: "Neues Buch",
            source_type: "quellenband",
            is_official: true,
            license_statement: "unrecorded",
            license_key: null,
            attribution: null,
            corpus_key: null,
            source_system: "wikisync",
            is_active: true,
            hat_still: false,
            retired_origin: null,
            revision: 1,
        });
        expect(await anzahl()).toEqual([mengen[0]! + 1, mengen[1]! + 3, mengen[2]!]);

        // Die Verknüpfungen des Wikis folgen dem Artikel, behalten aber Zustand, Herkunft, Position und System.
        expect(await verwendung(ID.gareth, q["fluss"]!)).toMatchObject({
            reference_kind: "ausfuehrlich",
            pages: "40, 145",
            note: "Zerstörung",
            legacy_origin: "wiki_publication",
            state: "active",
            source_system: "legacy",
            position: 0,
        });
        expect(await verwendung(ID.weiden, q["fluss"]!)).toMatchObject({
            reference_kind: "ergaenzend",
            pages: "12",
            note: null,
            state: "active",
        });
        // Neue Verknüpfungen: Herkunft Wiki-Publikation, System wikisync, aktiv, hinter den vorhandenen des Trägers.
        const hoechste = Math.max(
            ...link.filter((zeile) => zeile["traeger_id"] === ID.gareth).map((zeile) => Number(zeile["position"])),
        );
        const neuePositionen: number[] = [];
        for (const [quelle, art, seiten] of [
            [q["zweiter"]!, "ergaenzend", "1"],
            [q["heft"]!, "ergaenzend", "4"],
            [neu["id"] as string, "ergaenzend", "12"],
        ] as const) {
            const zeile = await verwendung(ID.gareth, quelle);
            expect(zeile).toMatchObject({
                reference_kind: art,
                pages: seiten,
                note: null,
                legacy_origin: "wiki_publication",
                state: "active",
                is_active: true,
                retired_origin: null,
                source_system: "wikisync",
            });
            neuePositionen.push(Number(zeile["position"]));
        }
        expect(new Set(neuePositionen).size).toBe(3);
        expect(Math.min(...neuePositionen)).toBeGreaterThan(hoechste);
        // Still gelegt (nie gelöscht): die Zeile bleibt, mit Zeitpunkt und Herkunft wikisync; System und Herkunft der Zeile bleiben.
        expect(await verwendung(ID.gareth, q["alt"]!)).toMatchObject({
            reference_kind: "erwaehnung",
            pages: "2",
            legacy_origin: "wiki_publication",
            state: "retired",
            is_active: false,
            retired_origin: "wikisync",
            source_system: "legacy",
        });
        // 🔴 Ohne belegte Herkunft, der Redaktion, ein Tombstone und eine gleiche Verknüpfung bleiben, wie sie sind.
        const bleibt = (zeile: Record<string, unknown>): boolean =>
            ![q["fluss"], q["zweiter"], q["heft"], q["alt"], neu["id"]].includes(String(zeile["quelle"]));
        expect(ohneZeit((await verknuepfungen()).filter(bleibt))).toEqual(ohneZeit(link.filter(bleibt)));
        // Das Etikett von Gareth ist neu gerechnet (Rang 1: der Namensraum seines Artikels).
        expect(await kanonVon(ID.gareth)).toMatchObject({ canon: "official", derived_from: "avesmaps_regel" });

        // Eine Operation der Quelle wikisync, ein Eintrag je berührter Quelle; keine Ableitung.
        const [op] = await wert<{ source: string; action: string; operation_id: string }>(
            `SELECT source, action, operation_id::text FROM map_operation ORDER BY seq DESC LIMIT 1`,
        );
        expect(op).toMatchObject({ source: "wikisync", action: "wikisync.uebernehmen" });
        const eintraege = await wert<{
            quelle: string;
            revision_before: number | null;
            revision_after: number;
            changes: Record<string, { before: unknown; after: unknown }>;
        }>(
            `SELECT source_public_id::text AS quelle, revision_before::int AS revision_before, revision_after::int AS revision_after, changes
               FROM map_audit_event WHERE operation_id = '${op!.operation_id}' AND action = 'source.wikisync_uebernommen'`,
        );
        expect(eintraege.map((eintrag) => eintrag.quelle).sort()).toEqual(
            [q["fluss"], q["zweiter"], q["heft"], q["alt"], neu["id"]].sort(),
        );
        const eintragVon = (quelle: string) => eintraege.find((eintrag) => eintrag.quelle === quelle)!;
        expect(eintragVon(q["fluss"]!).changes["title"]).toEqual({
            before: "Am Grossen Fluss alt",
            after: "Am Großen Fluss",
        });
        expect(eintragVon(q["fluss"]!).revision_after).toBe(eintragVon(q["fluss"]!).revision_before! + 1);
        expect(eintragVon(q["zweiter"]!).changes["links"]).toEqual({
            before: [
                { kind: "place", carrierId: ID.gareth, state: "none", referenceKind: null, pages: null, note: null },
            ],
            after: [
                {
                    kind: "place",
                    carrierId: ID.gareth,
                    state: "active",
                    referenceKind: "ergaenzend",
                    pages: "1",
                    note: null,
                },
            ],
        });
        expect(eintragVon(q["alt"]!).changes["links"]).toEqual({
            before: [
                {
                    kind: "place",
                    carrierId: ID.gareth,
                    state: "active",
                    referenceKind: "erwaehnung",
                    pages: "2",
                    note: null,
                },
            ],
            after: [
                {
                    kind: "place",
                    carrierId: ID.gareth,
                    state: "retired",
                    referenceKind: "erwaehnung",
                    pages: "2",
                    note: null,
                },
            ],
        });
        expect(eintragVon(neu["id"] as string)).toMatchObject({ revision_before: null, revision_after: 1 });
        expect(eintragVon(neu["id"] as string).changes["created"]).toEqual({
            before: null,
            after: { key: NEUES_BUCH, title: "Neues Buch", sourceType: "quellenband", isOfficial: true, url: null },
        });
        expect(
            await zahl(`SELECT count(*)::int AS n FROM job WHERE state = 'QUEUED' AND kind NOT LIKE 'wiki\\_%'`),
        ).toBe(0);

        // Der zweite Lauf ändert nichts.
        await vorschau();
        const noch = await uebernehmen();
        expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });
        expect(await operationen()).toBe(1);

        // Rücknahme: Die Redaktion hat die Verknüpfung am Gebiet und die am neuen Heft seitdem geändert (bleiben, Befunde); alles andere kehrt zurück.
        await admin()`
            UPDATE territory_source SET note = 'Von der Redaktion', source_system = 'editor'
             WHERE territory_id = (SELECT id FROM territory WHERE public_id = ${ID.weiden}::uuid)
        `;
        await admin()`
            UPDATE place_source SET note = 'Redaktion am Heft', source_system = 'editor'
             WHERE place_id = (SELECT id FROM place WHERE public_id = ${ID.gareth}::uuid)
               AND source_id = (SELECT id FROM feature_source WHERE public_id = ${q["heft"]!}::uuid)
        `;
        const rueck = await zuruecknehmen(laufId, uebernahmeId);
        expect(rueck.status).toBe("fertig");
        expect(await verwendung(ID.gareth, q["fluss"]!)).toMatchObject({
            reference_kind: "ergaenzend",
            pages: "40",
            note: null,
        });
        expect(await verwendung(ID.weiden, q["fluss"]!)).toMatchObject({
            reference_kind: "ergaenzend",
            pages: "12",
            note: "Von der Redaktion",
            source_system: "editor",
        });
        // Angelegtes ist still gelegt (die Zeile bleibt), was die Redaktion änderte, bleibt aktiv, und die still gelegte Verknüpfung lebt wieder.
        expect(await verwendung(ID.gareth, q["zweiter"]!)).toMatchObject({
            state: "retired",
            is_active: false,
            retired_origin: "wikisync",
            source_system: "wikisync",
        });
        expect(await verwendung(ID.gareth, neu["id"] as string)).toMatchObject({
            state: "retired",
            retired_origin: "wikisync",
        });
        expect(await verwendung(ID.gareth, q["heft"]!)).toMatchObject({
            state: "active",
            note: "Redaktion am Heft",
            source_system: "editor",
        });
        expect(await verwendung(ID.gareth, q["alt"]!)).toMatchObject({
            state: "active",
            is_active: true,
            retired_origin: null,
            reference_kind: "erwaehnung",
            pages: "2",
        });
        // Die Quelle, die die Übernahme anlegte und an der nichts Aktives mehr hängt, ist still gelegt (nie gelöscht).
        expect(await quelleNachSchluessel(NEUES_BUCH)).toMatchObject({
            is_active: false,
            hat_still: true,
            retired_origin: "wikisync",
            source_system: "wikisync",
        });
        expect(
            (await quellenStand()).find((zeile) => (zeile as { public_id: string }).public_id === q["fluss"]),
        ).toMatchObject({
            title: "Am Grossen Fluss alt",
        });
        const rueckBefunde = await wert<{ objekt_id: string; feld: string; befund: string; objekt_art: string }>(
            `SELECT objekt_id::text, feld, befund, objekt_art FROM wikisync_uebernahme_befund
              WHERE uebernahme_id <> ${String(uebernahmeId)} AND befund = 'seit_uebernahme_geaendert' ORDER BY objekt_id`,
        );
        expect(rueckBefunde.map((befund) => befund.objekt_id).sort()).toEqual([q["fluss"], q["heft"]].sort());
        expect(await anzahl()).toEqual([mengen[0]! + 1, mengen[1]! + 3, mengen[2]!]);
        expect(await kanonVon(ID.gareth)).toMatchObject({ canon: "official" });

        // Die nächste Nennung belebt, was der WikiSync still legte: dieselbe Quelle, dieselben Zeilen, keine zweite Quelle.
        await admin()`
            UPDATE place_source SET source_system = 'wikisync', note = NULL
             WHERE place_id = (SELECT id FROM place WHERE public_id = ${ID.gareth}::uuid)
               AND source_id = (SELECT id FROM feature_source WHERE public_id = ${q["heft"]!}::uuid)
        `;
        const neuerLauf = await vorschau();
        const wieder = await zeilen(neuerLauf);
        expect(
            wieder
                .filter((zeile) => zeile.objekt_name === "Neues Buch" && zeile.feld.startsWith("verwendung_"))
                .map((zeile) => [zeile.objekt, zeile.wirkung, zeile.grund]),
        ).toEqual([
            [
                neu["id"],
                "uebernommen",
                "Neu zitiert; die Quelle hat der WikiSync still gelegt, sie lebt mit der Verknüpfung wieder auf",
            ],
        ]);
        expect(wieder.filter((zeile) => zeile.feld === KATALOG_FELD)).toEqual([]);
        const zweite = await uebernehmen();
        expect(zweite.bereiche[0]).toMatchObject({ status: "fertig" });
        expect(await quelleNachSchluessel(NEUES_BUCH)).toMatchObject({
            id: neu["id"],
            is_active: true,
            hat_still: false,
            retired_origin: null,
        });
        expect(await verwendung(ID.gareth, neu["id"] as string)).toMatchObject({
            state: "active",
            is_active: true,
            retired_origin: null,
            source_system: "wikisync",
            reference_kind: "ergaenzend",
        });
        expect(await verwendung(ID.gareth, q["zweiter"]!)).toMatchObject({ state: "active", retired_origin: null });
        expect(await anzahl()).toEqual([mengen[0]! + 1, mengen[1]! + 3, mengen[2]!]);
    });

    it("🔴 Nichts lebt wieder auf, was die Redaktion oder der Legacy-Zug entfernte: eine gelöste Verknüpfung, ein Tombstone und eine von jemand anderem still gelegte Quelle bleiben, wie sie sind; entsteht das Paar seit der Vorschau anders, bleibt der Bestand", async () => {
        await neueWelt();
        // Zweiter Band: die Redaktion hat ihre Verknüpfung gelöst; Heft: der Legacy-Zug hat die Quelle still gelegt.
        await verknuepfe("place", ID.gareth, q["zweiter"]!, {
            art: "ergaenzend",
            herkunft: "wiki_publication",
            zustand: "retired",
            stillgelegtVon: "editor",
        });
        await admin()`
            UPDATE feature_source SET is_active = FALSE, retired_at = now(), retired_origin = 'import' WHERE public_id = ${q["heft"]!}::uuid
        `;
        const laufId = await vorschau();
        const alle = await zeilen(laufId);
        const grundVon = (name: string): (string | null)[] =>
            alle
                .filter((zeile) => zeile.objekt_name === name && zeile.feld.startsWith("verwendung_"))
                .map((zeile) => zeile.grund);
        expect(grundVon("Zweiter Band")).toEqual(["Die Redaktion hat diese Verknüpfung gelöst"]);
        expect(grundVon("Aventurischer Bote Nr. 1")).toEqual([
            "Neu zitiert, die Quelle ist im Katalog stillgelegt; angelegt wird nichts",
        ]);
        const ergebnis = await uebernehmen();
        expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
        // Weder die gelöste Verknüpfung noch die still gelegte Quelle bekommen etwas.
        expect(await verwendung(ID.gareth, q["zweiter"]!)).toMatchObject({
            state: "retired",
            retired_origin: "editor",
        });
        expect(
            await zahl(
                `SELECT count(*)::int AS n FROM place_source WHERE source_id = (SELECT id FROM feature_source WHERE public_id = '${q["heft"]!}')`,
            ),
        ).toBe(0);

        // Seit der Vorschau legt jemand die Quelle „Neues Buch“ an und verknüpft Gareth selbst: Die Übernahme legt nichts doppelt an (ein Befund), die Redaktion behält ihre Verknüpfung.
        await neueWelt();
        await vorschau();
        await legeQuelleAn("neuesBuch", { titel: "Neues Buch (Redaktion)", schluessel: NEUES_BUCH, system: "editor" });
        await verknuepfe("place", ID.gareth, q["neuesBuch"]!, { art: "erwaehnung", seiten: "99", system: "editor" });
        const spaeter = await uebernehmen();
        expect(spaeter.bereiche[0]).toMatchObject({ status: "fertig" });
        expect(await zahl(`SELECT count(*)::int AS n FROM feature_source WHERE source_key = '${NEUES_BUCH}'`)).toBe(1);
        expect(await verwendung(ID.gareth, q["neuesBuch"]!)).toMatchObject({
            reference_kind: "erwaehnung",
            pages: "99",
            source_system: "editor",
        });
        const befunde = await wert<{ feld: string; grund: string }>(
            `SELECT feld, grund FROM wikisync_uebernahme_befund WHERE befund = 'seit_vorschau_geaendert' AND objekt_art = 'source' ORDER BY id`,
        );
        expect(befunde.map((befund) => befund.grund)).toContain("Die Verknüpfung gibt es inzwischen schon");
    });

    it("🔴 Übernahme gegen den Stand von jetzt: Hat die Redaktion die Verknüpfung oder den Titel seit der Vorschau geändert, bleibt ihr Wert (Befund)", async () => {
        await neueWelt();
        await vorschau();
        // Seit der Vorschau: Die Redaktion ändert die Seiten am Ort und den Titel der Quelle.
        await admin()`
            UPDATE place_source SET pages = '41' WHERE place_id = (SELECT id FROM place WHERE public_id = ${ID.gareth}::uuid)
               AND source_id = (SELECT id FROM feature_source WHERE public_id = ${q["fluss"]!}::uuid)
        `;
        await admin()`UPDATE feature_source SET title = 'Eigener Titel', source_system = 'editor' WHERE public_id = ${q["fluss"]!}::uuid`;
        // Und sie ändert die Verknüpfung, die der WikiSync still legen wollte.
        await admin()`
            UPDATE place_source SET pages = '3', source_system = 'editor' WHERE place_id = (SELECT id FROM place WHERE public_id = ${ID.gareth}::uuid)
               AND source_id = (SELECT id FROM feature_source WHERE public_id = ${q["alt"]!}::uuid)
        `;
        const ergebnis = await uebernehmen();
        expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
        expect(await verwendung(ID.gareth, q["fluss"]!)).toMatchObject({ reference_kind: "ergaenzend", pages: "41" });
        expect(await verwendung(ID.gareth, q["alt"]!)).toMatchObject({
            state: "active",
            pages: "3",
            source_system: "editor",
        });
        // Die zweite Verwendung (am Gebiet) steht noch, wie die Vorschau sie sah, und wird übernommen.
        expect(await verwendung(ID.weiden, q["fluss"]!)).toMatchObject({ reference_kind: "ergaenzend", pages: "12" });
        const [quelle] = await wert<{ title: string; source_system: string }>(
            `SELECT title, source_system FROM feature_source WHERE public_id = '${q["fluss"]!}'`,
        );
        expect(quelle).toEqual({ title: "Eigener Titel", source_system: "editor" });
        const befunde = await wert<{ feld: string; befund: string }>(
            `SELECT feld, befund FROM wikisync_uebernahme_befund WHERE befund = 'seit_vorschau_geaendert' ORDER BY feld`,
        );
        expect(befunde.map((befund) => befund.feld).sort()).toEqual(
            ["title", verwendungsFeld("place", ID.gareth), verwendungsFeld("place", ID.gareth)].sort(),
        );
    });

    it("🔴 Legacy-Zug: Gehören die Quellen dem WikiSync, lässt I18 sie aus (nichts gelesen, nichts geschrieben, ein Befund)", async () => {
        await neueWelt();
        const vorher = await quellenStand();
        const bericht = await importSources(admin(), {
            ok: true,
            revision: 99,
            type: "FeatureCollection",
            features: [],
        } as never);
        expect(bericht.skipped).toBe(true);
        expect(bericht.findings.map((befund) => befund.code)).toEqual(["bereich_wikisync"]);
        expect(await quellenStand()).toEqual(vorher);
        expect(await zahl(`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'sources'`)).toBe(0);
    });

    it("🔴 Rechte: Die Jobs-Rolle legt Quellen und Verknüpfungen an, legt still und rechnet den Kanon neu – ändert aber weder Adresse, Schlüssel, Art, Lizenz noch Zuordnung, und löscht nur im Zwischenspeicher des Kanons", async () => {
        await neueWelt();
        const quelle = q["fluss"]!;
        const verboten = [
            `UPDATE feature_source SET url = 'https://x.example/' WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET source_key = 'wikipub:x' WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET source_type = 'roman' WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET is_official = FALSE WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET license_statement = 'unfree' WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET attribution = 'x' WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET corpus_key = NULL WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET source_system = 'editor' WHERE public_id = '${quelle}'`,
            `UPDATE place_source SET legacy_origin = 'manual'`,
            `UPDATE place_source SET source_system = 'editor'`,
            `UPDATE place_source SET source_id = source_id`,
            `UPDATE place_source SET place_id = place_id`,
            `UPDATE territory_source SET position = 9`,
            `DELETE FROM place_source`,
            `DELETE FROM territory_source`,
            `DELETE FROM feature_source`,
            `INSERT INTO place_source (place_id, source_id, position, imported_at) SELECT 1, 1, 99, now() WHERE FALSE`,
            `INSERT INTO feature_source (source_key, identity_state, title, source_type, is_official, imported_at) SELECT 'wikipub:x', 'final', 'x', 'roman', TRUE, now() WHERE FALSE`,
            `UPDATE place_canon SET place_id = place_id`,
            `UPDATE place_canon SET created_at = now()`,
            `DELETE FROM place`,
            `DELETE FROM adventure`,
        ];
        const erlaubt = [
            `UPDATE feature_source SET title = 'ok' WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET revision = revision WHERE public_id = '${quelle}'`,
            `UPDATE feature_source SET is_active = FALSE, retired_at = now(), retired_origin = 'wikisync' WHERE FALSE`,
            `INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, license_statement, license_key, attribution, corpus_key, source_system) SELECT 'wikipub:x', 'final', NULL, 'x', 'roman', TRUE, 'unrecorded', NULL, NULL, NULL, 'wikisync' WHERE FALSE`,
            ...["place", "path", "territory", "region", "terrain_peak"].flatMap((t) => [
                `UPDATE ${t}_source SET reference_kind = reference_kind, pages = pages, note = note, updated_at = now()`,
                `UPDATE ${t}_source SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'wikisync' WHERE FALSE`,
                `INSERT INTO ${t}_source (${t}_id, source_id, reference_kind, pages, note, legacy_origin, position, state, source_system, is_active) SELECT 1, 1, NULL, NULL, NULL, 'wiki_publication', 99, 'active', 'wikisync', TRUE WHERE FALSE`,
                `INSERT INTO ${t}_canon (${t}_id, canon, designator_type, designator_count, designator_label, derived_from, source_revision, source_system, imported_at) SELECT 1, 'official', NULL, NULL, NULL, 'avesmaps_regel', NULL, 'avesmaps3d', now() WHERE FALSE`,
                `UPDATE ${t}_canon SET canon = canon, designator_type = designator_type, designator_count = designator_count, designator_label = designator_label, derived_from = derived_from, updated_at = now()`,
                `DELETE FROM ${t}_canon WHERE FALSE`,
            ]),
        ];
        const codes = await cluster!.codesAs(jobs(), [...verboten, ...erlaubt]);
        expect(codes).toEqual([
            ...Array<string>(verboten.length).fill("42501"),
            ...Array<string>(erlaubt.length).fill("ok"),
        ]);
    });

    it("🔴 Vorkommen: Der Lauf legt nur die Zitate der Einträge ab (traeger_art lore) – ihre Quellen (lore_entry_source) legt, ändert und löst er nie, die Übernahme ebenso; die App liest daraus den Kreis nach dem Wiki", async () => {
        await neueWelt();
        const eintrag = async (schluessel: string, name: string, adresse: string | null, zustand = "active") => {
            const aktiv = zustand === "active";
            const [zeile] = await admin()<{ id: string; public_id: string }[]>`
                INSERT INTO lore_entry (wiki_key, kind, name, wiki_url, state, is_active, retired_at, retired_origin)
                VALUES (${schluessel}, 'fauna', ${name}, ${adresse}, ${zustand}, ${aktiv}, ${aktiv ? null : new Date().toISOString()},
                        ${aktiv ? null : "editor"})
                RETURNING id::text, public_id::text
            `;
            return zeile!;
        };
        const haenge = async (
            eintragId: string,
            quelle: string,
            teil: { art: string; seiten: string | null; pos: number },
        ) => {
            await admin()`
                INSERT INTO lore_entry_source (lore_entry_id, source_id, reference_kind, pages, note, legacy_origin, position)
                SELECT ${eintragId}::bigint, f.id, ${teil.art}, ${teil.seiten}, NULL, 'wiki_publication', ${teil.pos}
                  FROM feature_source f WHERE f.public_id = ${quelle}::uuid
            `;
        };
        try {
            const tatzel = await eintrag(
                "zitat-tatzelwurm",
                "Tatzelwurm",
                "https://de.wiki-aventurica.de/wiki/Tatzelwurm",
            );
            // Der Eintrag der Redaktion ohne Artikel und ein unterdrückter Eintrag mit Artikel haben nichts zu zitieren.
            await eintrag("zitat-ohne", "Ohne Artikel", null);
            await eintrag("zitat-still", "Unterdrückt", "https://de.wiki-aventurica.de/wiki/Tatzelwurm", "suppressed");
            // Die Quellen des Eintrags: eine stimmt mit dem Artikel überein, eine weicht ab, eine nennt der Artikel nicht.
            await haenge(tatzel.id, q["raben"]!, { art: "ausfuehrlich", seiten: "7", pos: 0 });
            await haenge(tatzel.id, q["fluss"]!, { art: "erwaehnung", seiten: "1", pos: 1 });
            await haenge(tatzel.id, q["horas"]!, { art: "ergaenzend", seiten: "3", pos: 2 });

            const loreQuellen = (): Promise<Record<string, unknown>[]> =>
                wert(`SELECT * FROM lore_entry_source ORDER BY id`);
            const loreEintraege = (): Promise<Record<string, unknown>[]> =>
                wert(`SELECT * FROM lore_entry ORDER BY id`);
            const quellenVorher = await loreQuellen();
            const eintraegeVorher = await loreEintraege();
            expect(quellenVorher).toHaveLength(3);

            const laufId = await vorschau();
            const ergebnis = await uebernehmen();
            expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });

            // Die Zitate: je Quelle die stärkste Nennung des Artikels, nur für den Eintrag mit lesbarem Artikel, unter dem Schlüssel der Quelle der Karte.
            const zitate = await wert<Record<string, unknown>>(
                `SELECT traeger_art, traeger_id::text AS traeger_id, quelle_key, art, seiten, notiz, artikel
                   FROM wikisync_quelle_zitat WHERE lauf_id = ${String(laufId)} AND traeger_art = 'lore' ORDER BY quelle_key`,
            );
            expect(zitate).toEqual([
                {
                    traeger_art: "lore",
                    traeger_id: tatzel.public_id,
                    quelle_key: adressSchluessel(ADRESSE_FLUSS),
                    art: "ergaenzend",
                    seiten: "12",
                    notiz: null,
                    artikel: "Tatzelwurm",
                },
                {
                    traeger_art: "lore",
                    traeger_id: tatzel.public_id,
                    quelle_key: "wikipub:der-rabenkrieg",
                    art: "ausfuehrlich",
                    seiten: "7",
                    notiz: "Krieg",
                    artikel: "Tatzelwurm",
                },
                {
                    // „Neues Buch“ fehlt im Katalog: Der Schlüssel ist der, unter dem der Lauf die Quelle anlegen würde.
                    traeger_art: "lore",
                    traeger_id: tatzel.public_id,
                    quelle_key: NEUES_BUCH,
                    art: "erwaehnung",
                    seiten: "2",
                    notiz: null,
                    artikel: "Tatzelwurm",
                },
            ]);
            const [lauf] = await wert<{ zahlen: Record<string, Record<string, number>> }>(
                `SELECT zahlen FROM wikisync_lauf WHERE id = ${String(laufId)}`,
            );
            expect(lauf!.zahlen["quelle"]).toMatchObject({ zitateVorkommen: 3 });
            expect(lauf!.zahlen["quelle"]!["zitate"]).toBeGreaterThan(3);

            // 🔴 Die Quellen der Einträge und die Einträge selbst sind unberührt (Zeile für Zeile, mit Zeitstempeln); die Zeilen des Plans nennen keinen Eintrag.
            expect(await loreQuellen()).toEqual(quellenVorher);
            expect(await loreEintraege()).toEqual(eintraegeVorher);
            expect((await zeilen(laufId)).filter((zeile) => zeile.objekt_art === "lore")).toEqual([]);
            // Die Jobs-Rolle darf die Quellen eines Eintrags nicht schreiben, auch nicht versehentlich.
            expect(
                await cluster!.codesAs(jobs(), [
                    "UPDATE lore_entry_source SET pages = 'x'",
                    "UPDATE lore_entry_source SET state = 'retired', is_active = FALSE",
                    "DELETE FROM lore_entry_source",
                    "INSERT INTO lore_entry_source (lore_entry_id, source_id, position) SELECT 1, 1, 9 WHERE FALSE",
                ]),
            ).toEqual(["42501", "42501", "42501", "42501"]);

            // Die App liest den Vergleich: Lauf oben, Zitat je Quelle; die Quelle, die der Artikel nicht nennt, steht mit null da.
            const gelesen = await leseVorkommen(cluster!.app, tatzel.public_id);
            expect(gelesen?.quellenWiki).toMatchObject({ laufId });
            expect(gelesen?.quellen.map((quelle) => [quelle.sourceId, quelle.wiki])).toEqual([
                [q["raben"], { art: "ausfuehrlich", seiten: "7", notiz: "Krieg" }],
                [q["fluss"], { art: "ergaenzend", seiten: "12", notiz: null }],
                [q["horas"], null],
            ]);
        } finally {
            await admin()`DELETE FROM lore_entry_source`;
            await admin()`DELETE FROM lore_entry`;
        }
    });
});
