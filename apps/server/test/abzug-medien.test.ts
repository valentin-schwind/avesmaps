import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AbzugManifest, AbzugMedium } from "@avesmaps3d/shared";
import { EinspielenFehler } from "../src/abzug/fehler.ts";
import {
    legeMedienAb,
    medienSumme,
    medienTarName,
    medienZiel,
    planeMedien,
    pruefeMedienAblage,
    pruefeMedienListe,
    pruefeMedienStrom,
} from "../src/abzug/medien.ts";
import { listeTar, type TarEintrag } from "../src/abzug/tar.ts";
import { tarBytes } from "./support/abzug-export.ts";

/**
 * Die Mediendateien im Abzug, ohne Datenbank (WI-0251): die Liste des Manifests gegen die Köpfe des Tars, die Prüfsummen, das atomare Ablegen nach
 * `MEDIA_ROOT` und alles, was dabei schiefgehen kann. Das Zusammenspiel mit der Datenbank (Medienzeilen, Roundtrip) prüft `abzug-einspielen.test.ts`.
 *
 * Problemfälle: ein Pfad, der aus dem Ordner führt (Rückwärtsschritt, absolut, Laufwerk), zwei Namen, die auf Windows eine Datei wären, eine Datei, die
 * im Tar fehlt oder anders groß ist, ein Tar mit einer Datei, die das Manifest nicht nennt, eine verfälschte Datei, ein Ordner an der Stelle einer Datei,
 * eine Verknüpfung im Medienordner, die aus ihm hinausführt. Soll: nie etwas außerhalb von `MEDIA_ROOT`, nie eine halbe Datei, nie eine gelöschte.
 */

function sha(daten: Buffer): string {
    return createHash("sha256").update(daten).digest("hex");
}
function schluessel(klasse: string, daten: Buffer, endung: string): string {
    const hash = sha(daten);
    return `${klasse}/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.${endung}`;
}

const DATEN = {
    a: Buffer.from("Das erste Bild. ".repeat(60)),
    b: Buffer.from("Das zweite Bild. ".repeat(30)),
    c: Buffer.from("Das dritte Bild. ".repeat(10)),
};
const PFAD = {
    a: schluessel("private/source", DATEN.a, "jpg"),
    b: schluessel("published", DATEN.b, "webp"),
    c: schluessel("derivatives", DATEN.c, "png"),
};

function medium(name: keyof typeof DATEN): AbzugMedium {
    return { pfad: PFAD[name], groesse: DATEN[name].length, sha256: sha(DATEN[name]) };
}

function manifestMit(medien: AbzugMedium[], medienFehlend: string[] = []): AbzugManifest {
    return { tafeln: [], medien, medienFehlend } as unknown as AbzugManifest;
}

describe("Abzug: Mediendateien (ohne Datenbank)", () => {
    let ordner: string;
    let zaehler = 0;

    beforeAll(() => {
        ordner = mkdtempSync(join(tmpdir(), "abzug-medien-"));
    });
    afterAll(() => {
        rmSync(ordner, { recursive: true, force: true });
    });

    /** Ein Tar mit Manifest und den genannten Dateien; gibt Pfad und Köpfe zurück. */
    async function tarMit(
        dateien: readonly { name: string; daten: Buffer }[],
    ): Promise<{ pfad: string; eintraege: TarEintrag[] }> {
        zaehler += 1;
        const pfad = join(ordner, `t${String(zaehler)}.tar`);
        writeFileSync(pfad, tarBytes([{ name: "manifest.json", daten: Buffer.from("{}\n") }, ...dateien]));
        return { pfad, eintraege: await listeTar(pfad) };
    }
    const alle = (): { name: string; daten: Buffer }[] =>
        (["a", "b", "c"] as const).map((n) => ({ name: medienTarName(PFAD[n]), daten: DATEN[n] }));

    function wurzel(): string {
        zaehler += 1;
        return join(ordner, `w${String(zaehler)}`);
    }

    function dateienUnter(ort: string, praefix = ""): string[] {
        if (!existsSync(ort)) return [];
        return readdirSync(ort, { withFileTypes: true }).flatMap((eintrag) =>
            eintrag.isDirectory()
                ? dateienUnter(join(ort, eintrag.name), `${praefix}${eintrag.name}/`)
                : [`${praefix}${eintrag.name}`],
        );
    }

    it("zählt Dateien, Größe und die an der Quelle fehlenden", () => {
        expect(medienSumme(manifestMit([medium("a"), medium("b")], ["published/sha256/00/00/x.webp"]))).toEqual({
            dateien: 2,
            bytes: DATEN.a.length + DATEN.b.length,
            fehlend: 1,
        });
    });

    it("🔴 die Liste des Manifests gegen die Köpfe: Pfade, doppelt, fehlt, andere Größe, fremde Datei", async () => {
        const gut = await tarMit(alle());
        const manifest = manifestMit([medium("a"), medium("b"), medium("c")]);
        expect(pruefeMedienListe(manifest, gut.eintraege)).toEqual({ pfade: [], dateien: [] });

        // Unzulässige Pfade: Rückwärtsschritt, absolut, Laufwerk, falsches Verzeichnis. Das Manifest allein reicht, kein Tar nötig.
        const boese = manifestMit(
            [
                { ...medium("a"), pfad: "published/../../x.webp" },
                { ...medium("b"), pfad: "/etc/passwd" },
                { ...medium("c"), pfad: "C:/Windows/x.dll" },
            ],
            ["private/evidence/sha256/ab/cd/x.pdf"],
        );
        const befund = pruefeMedienListe(boese, gut.eintraege);
        expect(befund.pfade).toHaveLength(1);
        expect(befund.pfade[0]).toContain("unzulässig");
        expect(befund.pfade[0]).toContain("published/../../x.webp");
        expect(befund.pfade[0]).toContain("und 1 weitere"); // der Beleg unter private/evidence/ ist der vierte

        // Zwei Namen, die auf Windows dieselbe Datei wären, und derselbe Pfad unter medien und medienFehlend.
        const hash = "ab".repeat(32);
        const grossKlein = manifestMit([
            { pfad: `published/sha256/ab/ab/${hash}.webp`, groesse: 1, sha256: hash },
            {
                pfad: `published/sha256/ab/ab/${hash.toUpperCase().replace(/^AB/u, "ab")}.webp`,
                groesse: 1,
                sha256: hash,
            },
        ]);
        expect(pruefeMedienListe(grossKlein, []).pfade.join(";")).toContain("doppelt");
        const doppelt = manifestMit([medium("a")], [PFAD.a]);
        expect(pruefeMedienListe(doppelt, gut.eintraege).pfade.join(";")).toContain("doppelt");

        // Im Tar fehlt eine Datei, eine hat eine andere Größe, eine steht im Tar, aber nicht im Manifest, eine kommt zweimal vor.
        const luecke = await tarMit(alle().filter((_, index) => index !== 1));
        expect(pruefeMedienListe(manifest, luecke.eintraege).dateien.join(";")).toContain("fehlt im Abzug");
        const kurz = await tarMit([
            ...alle().slice(0, 2),
            { name: medienTarName(PFAD.c), daten: DATEN.c.subarray(0, 5) },
        ]);
        expect(pruefeMedienListe(manifest, kurz.eintraege).dateien.join(";")).toContain("andere Größe");
        const fremd = await tarMit([...alle(), { name: "medien/published/sha256/00/00/fremd.webp", daten: DATEN.a }]);
        expect(pruefeMedienListe(manifest, fremd.eintraege).dateien.join(";")).toContain("nicht im Manifest");
        const zweimal = await tarMit([...alle(), alle()[0]!]);
        expect(pruefeMedienListe(manifest, zweimal.eintraege).dateien.join(";")).toContain("mehrfach im Abzug");
        // Die an der Quelle fehlende Datei ist kein Fehler.
        const ohneC = await tarMit(alle().slice(0, 2));
        expect(pruefeMedienListe(manifestMit([medium("a"), medium("b")], [PFAD.c]), ohneC.eintraege)).toEqual({
            pfade: [],
            dateien: [],
        });
    });

    it("🔴 jede Datei geht vor dem Ersetzen durch den Hash: eine verfälschte hält an, auch bei gleicher Größe", async () => {
        const gut = await tarMit(alle());
        const manifest = manifestMit([medium("a"), medium("b"), medium("c")]);
        const fortschritt: number[] = [];
        await pruefeMedienStrom(gut.pfad, manifest, gut.eintraege, (anteil) => fortschritt.push(anteil));
        expect(fortschritt.at(-1)).toBe(1);
        expect(fortschritt).toEqual([...fortschritt].sort((x, y) => x - y));

        const verfaelscht = await tarMit([
            alle()[0]!,
            { name: medienTarName(PFAD.b), daten: Buffer.concat([DATEN.b.subarray(0, -1), Buffer.from("X")]) },
            alle()[2]!,
        ]);
        const fehler = await pruefeMedienStrom(verfaelscht.pfad, manifest, verfaelscht.eintraege).catch(
            (error: unknown) => error,
        );
        expect(fehler).toBeInstanceOf(EinspielenFehler);
        expect((fehler as EinspielenFehler).code).toBe("pruefsumme");
        expect((fehler as EinspielenFehler).message).toContain("Nichts wurde verändert");

        const luecke = await tarMit(alle().slice(0, 2));
        const fehlt = await pruefeMedienStrom(luecke.pfad, manifest, luecke.eintraege).catch((error: unknown) => error);
        expect((fehlt as EinspielenFehler).code).toBe("datei");
    });

    it("legt Dateien atomar ab: fehlende und abweichende werden geschrieben, gleich große bleiben, Zusatzdateien werden nie gelöscht", async () => {
        const tar = await tarMit(alle());
        const manifest = manifestMit([medium("a"), medium("b"), medium("c")]);
        const lokal = wurzel();
        // b liegt schon (gleich groß), c liegt mit anderer Größe, eine Zusatzdatei liegt daneben.
        const ziel = (n: keyof typeof PFAD): string => join(lokal, ...PFAD[n].split("/"));
        mkdirSync(dirname(ziel("b")), { recursive: true });
        writeFileSync(ziel("b"), DATEN.b);
        mkdirSync(dirname(ziel("c")), { recursive: true });
        writeFileSync(ziel("c"), "zu kurz");
        mkdirSync(join(lokal, "published"), { recursive: true });
        writeFileSync(join(lokal, "published", "zusatz.txt"), "bleibt");

        const plan = await planeMedien(lokal, manifest.medien);
        expect(plan.vorhanden).toBe(1);
        expect(plan.zuSchreiben.map((m) => m.pfad).sort()).toEqual([PFAD.a, PFAD.c].sort());

        const fortschritt: number[] = [];
        const ergebnis = await legeMedienAb(tar.pfad, lokal, manifest, tar.eintraege, (anteil) =>
            fortschritt.push(anteil),
        );
        expect(ergebnis).toMatchObject({ dateien: 3, geschrieben: 2, vorhanden: 1, offen: 0, ersterFehler: null });
        expect(ergebnis.bytes).toBe(DATEN.a.length + DATEN.c.length);
        expect(fortschritt.at(-1)).toBe(1);
        for (const n of ["a", "b", "c"] as const) expect(readFileSync(ziel(n))).toEqual(DATEN[n]);
        expect(readFileSync(join(lokal, "published", "zusatz.txt"), "utf8")).toBe("bleibt");
        expect(dateienUnter(lokal).filter((name) => name.endsWith(".part"))).toEqual([]);
        // Noch einmal: nichts mehr zu tun.
        expect(await legeMedienAb(tar.pfad, lokal, manifest, tar.eintraege)).toMatchObject({
            geschrieben: 0,
            vorhanden: 3,
            offen: 0,
        });
    });

    it("🔴 scheitert eine Datei, zählt sie als offen, die übrigen kommen an, und keine Temporärdatei bleibt", async () => {
        const tar = await tarMit(alle());
        const manifest = manifestMit([medium("a"), medium("b"), medium("c")]);
        const lokal = wurzel();
        // An die Stelle von b tritt ein Ordner: das Umbenennen scheitert.
        mkdirSync(join(lokal, ...PFAD.b.split("/")), { recursive: true });
        const ergebnis = await legeMedienAb(tar.pfad, lokal, manifest, tar.eintraege);
        expect(ergebnis).toMatchObject({ dateien: 3, geschrieben: 2, offen: 1 });
        expect(ergebnis.ersterFehler).toContain(PFAD.b);
        expect(readFileSync(join(lokal, ...PFAD.a.split("/")))).toEqual(DATEN.a);
        expect(readFileSync(join(lokal, ...PFAD.c.split("/")))).toEqual(DATEN.c);
        expect(dateienUnter(lokal).filter((name) => name.endsWith(".part"))).toEqual([]);
    });

    it("🔴 eine Datei, die nach dem Prüfen im Tar anders ist, wird nicht abgelegt", async () => {
        // Das Manifest nennt die Prüfsumme der echten Bytes; das Tar trägt andere (gleich lang): Das Ablegen prüft noch einmal und verwirft.
        const tar = await tarMit([
            { name: medienTarName(PFAD.a), daten: Buffer.concat([DATEN.a.subarray(0, -1), Buffer.from("X")]) },
        ]);
        const lokal = wurzel();
        const ergebnis = await legeMedienAb(tar.pfad, lokal, manifestMit([medium("a")]), tar.eintraege);
        expect(ergebnis).toMatchObject({ geschrieben: 0, offen: 1 });
        expect(dateienUnter(lokal)).toEqual([]);
    });

    it("🔴 das Ziel bleibt unter MEDIA_ROOT: Rückwärtsschritte werden abgewiesen, und eine Verknüpfung im Medienordner führt nicht hinaus", async () => {
        const lokal = wurzel();
        expect(() => medienZiel(lokal, "published/../../x.webp")).toThrow(/unzulässig/u);
        expect(() => medienZiel(lokal, "/abs/x.webp")).toThrow(/unzulässig/u);
        expect(() => medienZiel(lokal, "C:/x.webp")).toThrow(/unzulässig/u);
        expect(medienZiel(lokal, PFAD.b).startsWith(lokal)).toBe(true);

        // `published` im Medienordner ist eine Verknüpfung auf einen Ordner außerhalb (unter Windows eine Junction, die keine Rechte braucht).
        const draussen = join(ordner, `draussen-${String(zaehler)}`);
        mkdirSync(draussen, { recursive: true });
        mkdirSync(lokal, { recursive: true });
        symlinkSync(draussen, join(lokal, "published"), "junction");
        const tar = await tarMit(alle());
        const ergebnis = await legeMedienAb(
            tar.pfad,
            lokal,
            manifestMit([medium("a"), medium("b"), medium("c")]),
            tar.eintraege,
        );
        // a (private/source) und c (derivatives) liegen im Medienordner, b (published) wurde verweigert; außerhalb steht nichts.
        expect(ergebnis).toMatchObject({ geschrieben: 2, offen: 1 });
        expect(ergebnis.ersterFehler).toContain("Verknüpfung");
        expect(dateienUnter(draussen)).toEqual([]);
    });

    it("prüft vor dem Einspielen, ob es einen Ort und Platz gibt; ohne Mediendateien gibt es nichts zu prüfen", async () => {
        const manifest = manifestMit([medium("a")]);
        expect((await pruefeMedienAblage(undefined, manifest)).map((p) => p.code)).toEqual(["medien_ablage"]);
        expect((await pruefeMedienAblage("  ", manifest)).map((p) => p.code)).toEqual(["medien_ablage"]);
        expect(await pruefeMedienAblage(undefined, manifestMit([]))).toEqual([]);
        // Eine Wurzel, die es noch nicht gibt, ist in Ordnung, solange der nächste Ordner darüber beschreibbar ist (das Ablegen legt sie an).
        expect(await pruefeMedienAblage(wurzel(), manifest)).toEqual([]);
        // Zu wenig Platz: Das Manifest nennt eine Datei, die kein Laufwerk fasst.
        const riesig = manifestMit([{ ...medium("a"), groesse: 2 ** 50 }]);
        const voll = await pruefeMedienAblage(wurzel(), riesig);
        expect(voll.map((p) => p.code)).toEqual(["medien_platz"]);
        expect(voll[0]?.detail).toMatch(/frei .* GB, nötig etwa .* GB/u);
        // Schon vorhandene Dateien brauchen keinen Platz.
        const lokal = wurzel();
        mkdirSync(dirname(join(lokal, ...PFAD.a.split("/"))), { recursive: true });
        writeFileSync(join(lokal, ...PFAD.a.split("/")), DATEN.a);
        expect(await pruefeMedienAblage(lokal, manifest)).toEqual([]);
    });
});
