import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import type { Abruf } from "../src/http/oeffentlicher-abruf.ts";
import { ApiError } from "../src/http/api-error.ts";
import { adressVergleich, findeGleicheQuelle, korpusSchluesselDerAdresse } from "../src/inhalte/adress-vergleich.ts";
import { bestandVon, istDateiAdresse, type BestandsGruppe } from "../src/inhalte/korpora-vorgabe.ts";
import { adressAuskunft } from "../src/inhalte/quellen-adresse.ts";
import { legeQuelleAn, schluesselDerAdresse } from "../src/inhalte/quellen-schreiben.ts";
import { klartext, leseSeitentitel } from "../src/inhalte/seitentitel.ts";

/**
 * Eine neue Quelle per Link (WI-0277). Problemfälle: Dieselbe Seite entsteht zweimal, weil die Adresse anders geschrieben ist; zwei verschiedene Seiten fallen zusammen; der Korpus wird nicht erkannt oder eine Quelle bekommt andere Werte als
 * die Auskunft zeigte; eine bekannte Seite fragt den fremden Server trotzdem; fremdes Markup kommt als Titel durch.
 */

describe("Adressen angleichen", () => {
    const grund = "https://www.herzogtum-weiden.net/geographie/fluesse-und-seen";

    it.each([
        "http://www.herzogtum-weiden.net/geographie/fluesse-und-seen",
        "https://herzogtum-weiden.net/geographie/fluesse-und-seen",
        "http://herzogtum-weiden.net/geographie/fluesse-und-seen/",
        "https://www.herzogtum-weiden.net/geographie/fluesse-und-seen/",
        "https://WWW.Herzogtum-Weiden.NET/geographie/fluesse-und-seen",
        "https://www.herzogtum-weiden.net:443/geographie/fluesse-und-seen",
        "https://www.herzogtum-weiden.de/geographie/fluesse-und-seen",
        "http://herzogtum-weiden.de/geographie/fluesse-und-seen/",
        "  https://www.herzogtum-weiden.net/geographie/fluesse-und-seen  ",
    ])("🔴 %s ist dieselbe Seite", (adresse) => {
        expect(adressVergleich(adresse)).toBe(adressVergleich(grund));
    });

    it.each([
        "https://www.herzogtum-weiden.net/geographie/fluesse-und-seen/amorin",
        "https://www.herzogtum-weiden.net/geographie/Fluesse-und-Seen",
        "https://www.herzogtum-weiden.net/geographie/fluesse-und-seen?seite=2",
        "https://www.herzogtum-weiden.net/geographie/fluesse-und-seen#amorin",
        "https://www2.herzogtum-weiden.net/geographie/fluesse-und-seen",
        "https://www.herzogtum-weiden.com/geographie/fluesse-und-seen",
        "https://www.herzogtum-weiden.net:8080/geographie/fluesse-und-seen",
    ])("🔴 %s ist eine andere Seite", (adresse) => {
        expect(adressVergleich(adresse)).not.toBe(adressVergleich(grund));
    });

    it("🔴 der Korpusschlüssel: herzogtum-weiden.de löst auf herzogtum-weiden.net auf, sonst bleibt es die Domain", () => {
        expect(korpusSchluesselDerAdresse("https://www.herzogtum-weiden.de/seite")).toBe("herzogtum-weiden.net");
        expect(korpusSchluesselDerAdresse("https://www.herzogtum-weiden.net/seite")).toBe("herzogtum-weiden.net");
        expect(korpusSchluesselDerAdresse("https://wiki.punin.de/Baronie_Pildek")).toBe("punin.de");
        expect(korpusSchluesselDerAdresse("https://horaswiki.de/wiki/Hauptseite")).toBe("horaswiki.de");
    });

    it("die Abfrage trennt: zwei Seiten eines Wikis fallen nicht zusammen", () => {
        expect(adressVergleich("https://wiki.example.org/index.php?title=A")).not.toBe(
            adressVergleich("https://wiki.example.org/index.php?title=B"),
        );
    });

    it("Umlaute und ihre Kodierung sind gleich, Groß und Klein der Kodierung auch", () => {
        const erwartet = adressVergleich("https://wiki.example.org/Gr%C3%A4fin");
        expect(adressVergleich("https://wiki.example.org/Gräfin")).toBe(erwartet);
        expect(adressVergleich("https://wiki.example.org/Gr%c3%a4fin")).toBe(erwartet);
    });

    it("die Wurzel einer Domain mit und ohne Schrägstrich", () => {
        expect(adressVergleich("https://example.org")).toBe(adressVergleich("https://example.org/"));
    });

    it("keine Webadresse: kein Vergleichswert", () => {
        expect(adressVergleich("kein link")).toBeUndefined();
        expect(adressVergleich("ftp://example.org/")).toBeUndefined();
    });
});

describe("Der Titel einer Seite", () => {
    it("die Überschrift schlägt den Titel (Legacy, gemessen: der Titel trägt den Zusatz des Wikis)", () => {
        expect(
            leseSeitentitel("<title>Baronie Taubental – Almada Wiki</title><h1>Baronie <span>Taubental</span></h1>"),
        ).toBe("Baronie Taubental");
    });

    it("ohne Überschrift gilt der Titel", () => {
        expect(leseSeitentitel("<head><title>Flüsse und Seen in Weiden</title></head><p>Text</p>")).toBe(
            "Flüsse und Seen in Weiden",
        );
    });

    it("🔴 ist die Überschrift nur der Name der Seite, gilt der Kopf des Titels", () => {
        expect(leseSeitentitel("<title>Amorîn – Herzogtum Weiden</title><h1>Herzogtum Weiden</h1>")).toBe("Amorîn");
    });

    it("Entities und geschützte Leerzeichen", () => {
        expect(leseSeitentitel("<h1>Gr&auml;flich&nbsp;Abagund &amp; Umland &#8211; Teil 2</h1>")).toBe(
            "Gräflich Abagund & Umland – Teil 2",
        );
    });

    it("🔴 fremdes Markup kommt nicht durch", () => {
        const titel = leseSeitentitel('<h1>Trallop<script>alert(1)</script><img src=x onerror="alert(2)"></h1>');
        expect(titel).toBe("Trallop");
        expect(klartext("<b onclick=x>fett</b>\n\t‮umgedreht\u0007")).toBe("fett umgedreht");
    });

    it("eine Überschrift im Kommentar oder Skript ist keine", () => {
        expect(leseSeitentitel('<!-- <h1>Alt</h1> --><script>var a="<h1>Skript</h1>"</script><h1>Echt</h1>')).toBe(
            "Echt",
        );
    });

    it("🔴 ein abgeschnittener Rumpf ergibt nichts Halbes", () => {
        expect(leseSeitentitel("<title>Ganz</title><h1>Abgeschn")).toBe("Ganz");
        expect(leseSeitentitel("<title>Abgeschn")).toBe("");
        expect(leseSeitentitel("<!-- nie zu")).toBe("");
    });

    it("🔴 höchstens so lang, wie eine Quelle sein darf", () => {
        expect(Array.from(leseSeitentitel(`<h1>${"ä".repeat(5000)}</h1>`))).toHaveLength(300);
    });

    it("🔴 ein Rumpf voller Anfänge läuft nicht hin und zurück", () => {
        const start = Date.now();
        leseSeitentitel("<script ".repeat(16_000));
        leseSeitentitel("<title ".repeat(18_000));
        leseSeitentitel("<h1>".repeat(32_000));
        expect(Date.now() - start).toBeLessThan(1500);
    });

    it("🔴 trägt der Titel nur den Namen des Korpus als Zusatz, fällt der weg (herzogtum-weiden.net, gemessen: keine Überschrift auf der Übersicht)", () => {
        const seite = "<title>Herzogtum Weiden | Geographie | Gewässer</title><h2>Weidens Gewässer</h2>";
        expect(leseSeitentitel(seite, "Herzogtum Weiden")).toBe("Geographie | Gewässer");
        expect(leseSeitentitel(seite)).toBe("Herzogtum Weiden | Geographie | Gewässer");
        expect(leseSeitentitel("<title>Amorîn – AlberniaWiki</title>", "AlberniaWiki")).toBe("Amorîn");
        expect(leseSeitentitel("<title>Herzogtum Weiden</title>", "Herzogtum Weiden")).toBe("Herzogtum Weiden");
    });

    it("nichts zu lesen", () => {
        expect(leseSeitentitel("<p>Nur Text</p>")).toBe("");
    });
});

describe("Was die Quellen einer Domain gemeinsam sagen", () => {
    const CC = { lizenzAussage: "license", lizenzKey: "cc-by-nc-sa-3.0" };
    const OHNE = { lizenzAussage: "unrecorded", lizenzKey: null };
    const gruppe = (
        n: number,
        sourceType: string,
        lizenz: { lizenzAussage: string; lizenzKey: string | null } = OHNE,
        attribution: string | null = null,
        isOfficial = false,
    ): BestandsGruppe => ({ n, sourceType, isOfficial, attribution, ...lizenz });

    it("🔴 herzogtum-weiden.net (Stage, gemessen): alle 93 gleich, also Art und Lizenz wie in Legacy", () => {
        expect(bestandVon("belegstelle", [gruppe(93, "briefspiel", CC)])).toEqual({
            sourceType: "briefspiel",
            isOfficial: false,
            lizenz: { aussage: "license", key: "cc-by-nc-sa-3.0" },
            attribution: null,
        });
    });

    it("„sonstiges“ ist keine Aussage: almada (29 Briefspiel, 15 sonstiges) ist Briefspiel, nordmarken (70 sonstiges) sagt nichts", () => {
        expect(bestandVon("belegstelle", [gruppe(29, "briefspiel"), gruppe(15, "sonstiges")]).sourceType).toBe(
            "briefspiel",
        );
        expect(bestandVon("", [gruppe(70, "sonstiges")]).sourceType).toBeNull();
    });

    it("eine Mehrheit muss eine sein: Wiki Aventurica (8 Abenteuer von 20) sagt nichts, ein Gleichstand auch nicht", () => {
        expect(bestandVon("", [gruppe(8, "abenteuer"), gruppe(12, "sonstiges")]).sourceType).toBeNull();
        expect(bestandVon("belegstelle", [gruppe(5, "briefspiel"), gruppe(5, "abenteuer")]).sourceType).toBeNull();
    });

    it("🔴 Werk-Korpus und unter drei Quellen: nichts", () => {
        expect(bestandVon("werk", [gruppe(50, "roman", CC, "Verlag")])).toEqual({
            sourceType: null,
            isOfficial: false,
            lizenz: null,
            attribution: null,
        });
        expect(bestandVon("belegstelle", [gruppe(2, "briefspiel", CC)]).sourceType).toBeNull();
    });

    it("🔴 eine Lizenz wird nicht erfunden: Wenige Aussagen oder uneinige Aussagen ergeben keine", () => {
        expect(bestandVon("belegstelle", [gruppe(10, "briefspiel", CC), gruppe(30, "briefspiel")]).lizenz).toBeNull();
        expect(
            bestandVon("belegstelle", [
                gruppe(50, "briefspiel", CC),
                gruppe(10, "briefspiel", { lizenzAussage: "license", lizenzKey: "cc-by-sa-4.0" }),
            ]).lizenz,
        ).toBeNull();
        expect(
            bestandVon("belegstelle", [
                gruppe(99, "briefspiel", CC),
                gruppe(1, "briefspiel", { lizenzAussage: "license", lizenzKey: "cc-by-sa-4.0" }),
            ]).lizenz,
        ).toEqual({ aussage: "license", key: "cc-by-nc-sa-3.0" });
        expect(
            bestandVon("belegstelle", [gruppe(9, "briefspiel", { lizenzAussage: "public_domain", lizenzKey: null })])
                .lizenz,
        ).toEqual({ aussage: "public_domain", key: null });
    });

    it("die Namensnennung folgt derselben Regel, eine leere ist keine Aussage", () => {
        expect(
            bestandVon("belegstelle", [gruppe(9, "briefspiel", OHNE, "Die Runde"), gruppe(2, "briefspiel")])
                .attribution,
        ).toBe("Die Runde");
        expect(
            bestandVon("belegstelle", [gruppe(5, "briefspiel", OHNE, "A"), gruppe(5, "briefspiel", OHNE, "B")])
                .attribution,
        ).toBeNull();
    });

    it("„offiziell“ nur, wenn mindestens zwei Drittel es sind", () => {
        expect(bestandVon("", [gruppe(9, "abenteuer", OHNE, null, true), gruppe(11, "sonstiges")]).isOfficial).toBe(
            false,
        );
        expect(bestandVon("", [gruppe(14, "abenteuer", OHNE, null, true), gruppe(6, "sonstiges")]).isOfficial).toBe(
            true,
        );
    });
});

describe("Eine Datei erbt keine Rechte", () => {
    it.each([
        "https://westlande.de/albernia/images/4/4f/Baronie_Hohenfels.jpg",
        "https://westlande.de/albernia/index.php?title=Datei:Tannwald_1032.jpg",
        "https://wiki.punin.de/Kaiserlich_Selaque#/media/Datei:SelaqueKarteNeu.jpg",
        "https://www.koschwiki.de/images/3/30/B%C3%A4renfang_Lehen_Grenzen.JPG",
        "https://example.org/karte.pdf?v=2",
    ])("%s ist eine Datei", (adresse) => {
        expect(istDateiAdresse(adresse)).toBe(true);
    });

    it.each([
        "https://westlande.de/albernia/index.php?title=Rodaschpfad",
        "https://westlande.de/albernia/index.php?title=Bildung",
        "https://www.herzogtum-weiden.net/geographie/fluesse-und-seen",
        "https://wiki.punin.de/Baronie_Art%C3%A9sa",
    ])("%s ist eine Seite", (adresse) => {
        expect(istDateiAdresse(adresse)).toBe(false);
    });
});

const url = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = url ? describe : describe.skip;
const redakteur: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
const operationen: string[] = [];
const neu = (): string => {
    const id = randomUUID();
    operationen.push(id);
    return id;
};
const BELEG = "p277beleg.example";
const WERK = "p277werk.example";
const FREMD = "p277fremd.example";
const LEER = "p277leer.example";
const SEITE = `https://www.${BELEG}/geographie/fluesse-und-seen`;

describeWithDatabase("Die Auskunft zu einem Link (WI-0277)", () => {
    let database: Database;
    let abrufe: string[] = [];
    const seite =
        (antwort: Abruf) =>
        (adresse: string): Promise<Abruf> => {
            abrufe.push(adresse);
            return Promise.resolve(antwort);
        };
    const gelesen = seite({ art: "antwort", status: 200, html: "<h1>Flüsse und Seen in Weiden</h1>" });

    const aufraeumen = async (): Promise<void> => {
        await database`DELETE FROM feature_source WHERE url LIKE ${"%p277%.example%"} OR url LIKE ${"%herzogtum-weiden.%/p277%"}`;
        await database`DELETE FROM source_corpus WHERE corpus_key LIKE 'p277%'`;
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
    };

    beforeAll(async () => {
        database = createDatabase(url as string);
        await migrate(database);
        await aufraeumen();
        await database`
            INSERT INTO source_corpus (corpus_key, label, form, source_type, is_official, license_statement, license_key, attribution, source_system)
            VALUES (${BELEG}, 'P277 Herzogtum', 'belegstelle', 'briefspiel', false, 'license', 'cc-by-sa-3.0', 'Die Runde', 'test')
        `;
        await database`
            INSERT INTO source_corpus (corpus_key, label, form, license_statement, license_key, source_system)
            VALUES (${WERK}, 'P277 Werke', 'werk', 'license', 'cc-by-sa-3.0', 'test')
        `;
    }, 120_000);

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 ein Briefspiel-Link: Korpus aus der Domain, seine Angaben, Titel aus der Seite", async () => {
        abrufe = [];
        const a = await adressAuskunft(database, SEITE, gelesen);
        expect(abrufe).toEqual([SEITE]);
        expect(a).toMatchObject({
            url: SEITE,
            zustand: "gelesen",
            titel: "Flüsse und Seen in Weiden",
            vorhanden: null,
            korpus: {
                key: BELEG,
                name: "P277 Herzogtum",
                sourceType: "briefspiel",
                isOfficial: false,
                lizenzAussage: "license",
                attribution: "Die Runde",
                quellen: 0,
                objekte: 0,
            },
        });
        expect(a.korpus?.lizenzName).toMatch(/CC/u);
    });

    it("🔴 was die Auskunft zeigt, bekommt die Quelle: nur der Link und der Titel gehen über die Leitung", async () => {
        const antwort = await legeQuelleAn(database, redakteur, {
            operationId: neu(),
            url: SEITE,
            title: "Flüsse und Seen in Weiden",
        });
        const [zeile] = await database<
            {
                corpus_key: string;
                source_type: string;
                is_official: boolean;
                license_key: string;
                attribution: string;
            }[]
        >`
            SELECT corpus_key, source_type, is_official, license_key, attribution FROM feature_source WHERE public_id = ${antwort.publicId}::uuid
        `;
        expect(zeile).toEqual({
            corpus_key: BELEG,
            source_type: "briefspiel",
            is_official: false,
            license_key: "cc-by-sa-3.0",
            attribution: "Die Runde",
        });
    });

    it("🔴 eine bekannte Seite ist sofort fertig und fragt den fremden Server nicht", async () => {
        abrufe = [];
        const a = await adressAuskunft(database, SEITE, gelesen);
        expect(abrufe).toEqual([]);
        expect(a).toMatchObject({
            zustand: "bekannt",
            vorhanden: {
                title: "Flüsse und Seen in Weiden",
                url: SEITE,
                sourceType: "briefspiel",
                stillgelegt: false,
                uses: 0,
                gleicheAdresse: true,
            },
            korpus: { key: BELEG, quellen: 1 },
        });
    });

    it.each([
        `http://www.${BELEG}/geographie/fluesse-und-seen`,
        `https://${BELEG}/geographie/fluesse-und-seen`,
        `http://${BELEG}/geographie/fluesse-und-seen/`,
    ])("🔴 %s findet dieselbe Quelle und legt keine zweite an", async (variante) => {
        abrufe = [];
        const a = await adressAuskunft(database, variante, gelesen);
        expect(abrufe).toEqual([]);
        expect(a.zustand).toBe("bekannt");
        expect(a.vorhanden?.url).toBe(SEITE);
        expect(a.vorhanden?.gleicheAdresse).toBe(false);

        const fehler = await legeQuelleAn(database, redakteur, {
            operationId: neu(),
            url: variante,
            title: "Zweite",
        }).catch((grund: unknown) => grund);
        expect(fehler).toBeInstanceOf(ApiError);
        expect((fehler as ApiError).code).toBe("source_exists");
        expect((fehler as ApiError).details).toMatchObject({ sourceId: a.vorhanden?.id, active: true });
    });

    it("🔴 eine Unterseite ist eine eigene Quelle", async () => {
        const unterseite = `${SEITE}/amorin`;
        const a = await adressAuskunft(database, unterseite, gelesen);
        expect(a.zustand).toBe("gelesen");
        expect(a.vorhanden).toBeNull();
        const angelegt = await legeQuelleAn(database, redakteur, {
            operationId: neu(),
            url: unterseite,
            title: "Amorîn",
        });
        expect(angelegt.publicId).toMatch(/^[0-9a-f-]{36}$/u);
    });

    it("gibt es mehrere Schreibweisen im Bestand, gewinnt die aktive, unter den aktiven die genau gleiche", async () => {
        const https = `https://${BELEG}/doppelt`;
        const http = `http://${BELEG}/doppelt`;
        const mitWww = `https://www.${BELEG}/doppelt`;
        await database`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system, is_active, retired_at, retired_origin)
            VALUES (${schluesselDerAdresse(https)}, 'final', ${https}, 'Still', 'briefspiel', false, 'legacy', false, now(), 'editor'),
                   (${schluesselDerAdresse(http)}, 'final', ${http}, 'Aktiv', 'briefspiel', false, 'legacy', true, NULL, NULL),
                   (${schluesselDerAdresse(mitWww)}, 'final', ${mitWww}, 'Auch aktiv', 'briefspiel', false, 'legacy', true, NULL, NULL)
        `;
        expect((await findeGleicheQuelle(database, https))?.title).toBe("Aktiv");
        expect((await findeGleicheQuelle(database, mitWww))?.title).toBe("Auch aktiv");
    });

    it("eine unterdrückte Quelle gibt es weiterhin: Die Auskunft nennt sie, statt eine zweite anzulegen", async () => {
        const a = await adressAuskunft(database, `https://${BELEG}/still`, gelesen);
        expect(a.vorhanden).toBeNull();
        const b = await legeQuelleAn(database, redakteur, {
            operationId: neu(),
            url: `https://${BELEG}/still`,
            title: "S",
        });
        await database`UPDATE feature_source SET is_active = false, retired_at = now(), retired_origin = 'editor' WHERE public_id = ${b.publicId}::uuid`;
        const c = await adressAuskunft(database, `http://${BELEG}/still/`, gelesen);
        expect(c).toMatchObject({ zustand: "bekannt", vorhanden: { stillgelegt: true } });
    });

    it("🔴 ein Link ohne bekannten Korpus: kein Korpus, der Titel kommt trotzdem", async () => {
        const a = await adressAuskunft(database, `https://${FREMD}/eine-seite`, gelesen);
        expect(a).toMatchObject({ zustand: "gelesen", korpus: null, vorhanden: null });
        expect(a.titel).toBe("Flüsse und Seen in Weiden");
    });

    it("ein Korpus aus Werken gibt Art und „offiziell“ nicht vor, die Lizenz schon", async () => {
        const a = await adressAuskunft(database, `https://${WERK}/roman`, gelesen);
        expect(a.korpus).toMatchObject({ key: WERK, sourceType: null, isOfficial: null, lizenzAussage: "license" });
    });

    it("🔴 ein Korpus ohne eigene Angaben (Stage: alle aus dem Legacy-Abgleich): Art, Lizenz und Nennung kommen vom Bestand, und die Quelle bekommt sie auch", async () => {
        await database`
            INSERT INTO source_corpus (corpus_key, label, form, source_system) VALUES (${LEER}, 'P277 Leer', 'belegstelle', 'test')
        `;
        for (const seite of ["a", "b", "c"]) {
            const adresse = `https://${LEER}/${seite}`;
            await database`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, license_statement, license_key, attribution, corpus_key, source_system)
                VALUES (${schluesselDerAdresse(adresse)}, 'final', ${adresse}, ${seite}, 'briefspiel', false, 'license', 'cc-by-sa-3.0', 'Die Runde', ${LEER}, 'legacy')
            `;
        }
        const neueSeite = `https://${LEER}/neu`;
        const a = await adressAuskunft(database, neueSeite, gelesen);
        expect(a.korpus).toMatchObject({
            sourceType: null,
            isOfficial: null,
            artVorschlag: "briefspiel",
            offiziellVorschlag: false,
            lizenzAussage: "license",
            attribution: "Die Runde",
            rechteAusBestand: true,
            quellen: 3,
        });
        expect(a.korpus?.lizenzName).toMatch(/CC/u);

        // Die Fußzeile des AlberniaWiki: „Insbesondere Bilddateien können anderen Lizenzen unterliegen“. Art ja, Rechte nein.
        const bild = `https://${LEER}/images/karte.jpg`;
        const b = await adressAuskunft(database, bild, seite({ art: "antwort", status: 200 }));
        expect(b.korpus).toMatchObject({
            artVorschlag: "briefspiel",
            lizenzAussage: "unrecorded",
            lizenzName: null,
            attribution: null,
            rechteAusBestand: false,
        });
        const bildQuelle = await legeQuelleAn(database, redakteur, { operationId: neu(), url: bild, title: "Karte" });
        const [bildZeile] = await database<{ license_statement: string; attribution: string | null }[]>`
            SELECT license_statement, attribution FROM feature_source WHERE public_id = ${bildQuelle.publicId}::uuid
        `;
        expect(bildZeile).toEqual({ license_statement: "unrecorded", attribution: null });

        const nurLink = await legeQuelleAn(database, redakteur, { operationId: neu(), url: neueSeite, title: "Neu" });
        const gewaehlt = await legeQuelleAn(database, redakteur, {
            operationId: neu(),
            url: `https://${LEER}/gewaehlt`,
            title: "Gewählt",
            sourceType: "roman",
        });
        const zeilen = await database<
            { public_id: string; source_type: string; license_key: string; attribution: string }[]
        >`
            SELECT public_id::text, source_type, license_key, attribution FROM feature_source
             WHERE public_id = ANY(${[nurLink.publicId, gewaehlt.publicId]}::uuid[])
        `;
        const von = (id: string) => zeilen.find((zeile) => zeile.public_id === id);
        expect(von(nurLink.publicId)).toMatchObject({
            source_type: "briefspiel",
            license_key: "cc-by-sa-3.0",
            attribution: "Die Runde",
        });
        expect(von(gewaehlt.publicId)).toMatchObject({ source_type: "roman", license_key: "cc-by-sa-3.0" });
    });

    it("🔴 herzogtum-weiden.de: Der Link löst auf den Korpus von .net auf, und dieselbe Seite entsteht nicht zweimal", async () => {
        const schluessel = "herzogtum-weiden.net";
        const [schonDa] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM source_corpus WHERE corpus_key = ${schluessel}
        `;
        if (schonDa?.n === 0) {
            await database`
                INSERT INTO source_corpus (corpus_key, label, form, source_type, source_system)
                VALUES (${schluessel}, 'P277 Weiden', 'belegstelle', 'briefspiel', 'test')
            `;
        }
        try {
            const aufDe = "https://www.herzogtum-weiden.de/p277-gleich";
            const a = await adressAuskunft(database, aufDe, gelesen);
            expect(a).toMatchObject({ zustand: "gelesen", korpus: { key: schluessel }, vorhanden: null });

            const angelegt = await legeQuelleAn(database, redakteur, {
                operationId: neu(),
                url: aufDe,
                title: "Probe",
            });
            const [zeile] = await database<{ corpus_key: string; url: string }[]>`
                SELECT corpus_key, url FROM feature_source WHERE public_id = ${angelegt.publicId}::uuid
            `;
            expect(zeile).toEqual({ corpus_key: schluessel, url: aufDe });

            // Unter der anderen Domain ist es dieselbe Seite: bekannt, und kein zweites Anlegen.
            const aufNet = "https://www.herzogtum-weiden.net/p277-gleich";
            const b = await adressAuskunft(database, aufNet, gelesen);
            expect(b).toMatchObject({
                zustand: "bekannt",
                vorhanden: { id: angelegt.publicId, gleicheAdresse: false },
            });
            const fehler = await legeQuelleAn(database, redakteur, {
                operationId: neu(),
                url: aufNet,
                title: "Zweite",
            }).catch((grund: unknown) => grund);
            expect((fehler as ApiError).code).toBe("source_exists");
        } finally {
            await database`DELETE FROM feature_source WHERE url LIKE ${"%herzogtum-weiden.%/p277%"}`;
            if (schonDa?.n === 0) await database`DELETE FROM source_corpus WHERE corpus_key = ${schluessel}`;
        }
    });

    it("🔴 schlägt der Abruf fehl, gibt es trotzdem eine Auskunft", async () => {
        const adresse = `https://www.${BELEG}/neu`;
        expect(await adressAuskunft(database, adresse, seite({ art: "keine_antwort" }))).toMatchObject({
            zustand: "unerreichbar",
            korpus: { key: BELEG },
        });
        const nichtDa = await adressAuskunft(database, adresse, seite({ art: "antwort", status: 404 }));
        expect(nichtDa).toMatchObject({ zustand: "unerreichbar", httpStatus: 404 });
        expect(await adressAuskunft(database, adresse, seite({ art: "gesperrt" }))).toMatchObject({
            zustand: "nicht_geprueft",
        });
        expect(await adressAuskunft(database, adresse, seite({ art: "antwort", status: 200 }))).toMatchObject({
            zustand: "erreichbar",
        });
        expect(
            await adressAuskunft(database, adresse, seite({ art: "antwort", status: 200, html: "<p>kein Titel</p>" })),
        ).toMatchObject({ zustand: "erreichbar" });
    });

    it("eine Adresse, die keine Webadresse ist: 400, wie beim Anlegen", async () => {
        const fehler = await adressAuskunft(database, "javascript:alert(1)", gelesen).catch((grund: unknown) => grund);
        expect((fehler as ApiError).statusCode).toBe(400);
    });

    it("🔴 zwei gleichzeitige Anlagen derselben Seite in zwei Schreibweisen ergeben eine Quelle", async () => {
        const ergebnisse = await Promise.allSettled([
            legeQuelleAn(database, redakteur, { operationId: neu(), url: `https://${BELEG}/gleichzeitig`, title: "A" }),
            legeQuelleAn(database, redakteur, {
                operationId: neu(),
                url: `http://www.${BELEG}/gleichzeitig/`,
                title: "B",
            }),
        ]);
        expect(ergebnisse.filter((eine) => eine.status === "fulfilled")).toHaveLength(1);
    });
});
