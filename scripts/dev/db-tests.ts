// Die Datenbanktests eines Laufs (WI-0224): welche Dateien sie sind und wie das JSON von Vitest zu lesen ist.
//
// 🔴 Eine Testdatei braucht die Testdatenbank, wenn ihr Quelltext `TEST_DATABASE_URL` liest (`gebrauchteDatenbank`, wie die Sperre in
// `vitest.setup.ts`): Eine Liste wäre beim nächsten neuen Test still falsch. Die fünf Dateien, die nur `DATABASE_URL` lesen
// (Routing-Korpus, Dateninvarianten), brauchen die echten Kartendaten der Entwicklungsdatenbank und laufen auch im Wegwerf-Cluster nicht.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gebrauchteDatenbank } from "../../apps/server/test/support/test-umgebung.ts";
import type { TestDatei } from "./pruef-auswahl.ts";

/** Alle Testdateien unter `apps/<paket>/test` und `packages/<paket>/test` einer Wurzel mit ihrem Text (Pfad relativ, mit `/`). */
export function leseTestDateien(wurzel: string): TestDatei[] {
    const liste: TestDatei[] = [];
    for (const wurzelOrdner of ["apps", "packages"]) {
        const ordner = join(wurzel, wurzelOrdner);
        if (!existsSync(ordner)) continue;
        for (const paket of readdirSync(ordner)) {
            const tests = join(ordner, paket, "test");
            if (!existsSync(tests)) continue;
            const offen = [tests];
            for (let aktuell = offen.pop(); aktuell !== undefined; aktuell = offen.pop()) {
                for (const eintrag of readdirSync(aktuell, { withFileTypes: true })) {
                    const pfad = join(aktuell, eintrag.name);
                    if (eintrag.isDirectory() && eintrag.name !== "node_modules") offen.push(pfad);
                    else if (eintrag.isFile() && eintrag.name.endsWith(".test.ts")) {
                        liste.push({
                            pfad: `${wurzelOrdner}/${paket}/test/${pfad.slice(tests.length + 1).replace(/\\/g, "/")}`,
                            text: readFileSync(pfad, "utf8"),
                        });
                    }
                }
            }
        }
    }
    return liste;
}

/** Die Pfade der Testdateien, die die Testdatenbank brauchen, sortiert. */
export function dbTestDateien(testDateien: readonly TestDatei[]): string[] {
    return testDateien
        .filter((t) => gebrauchteDatenbank(t.text) === "testdatenbank")
        .map((t) => t.pfad)
        .sort();
}

export interface DateiErgebnis {
    /** Pfad relativ zur Wurzel mit `/`. */
    readonly datei: string;
    /** `uebersprungen`: kein einziger Fall lief (Datenbank, Werkzeug oder Verzeichnis fehlte). */
    readonly status: "gruen" | "rot" | "uebersprungen";
    /** Bei Rot: der erste rote Fall, sonst der Fehler der Datei selbst (Hook, Import). */
    readonly test?: string;
    /** Bei Rot: die erste Fehlermeldung, ohne Farbcodes, gekürzt. */
    readonly meldung?: string;
    readonly dauerMs: number;
}

const FARBCODES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Die ersten Zeilen einer Fehlermeldung ohne Farbcodes, auf höchstens `max` Zeichen. */
export function ersteMeldung(texte: readonly string[], max = 400): string {
    const text = (texte.find((t) => t.trim() !== "") ?? "").replace(FARBCODES, "").trim();
    const zeilen = text.split(/\r?\n/).filter((z) => z.trim() !== "");
    const kurz = zeilen.slice(0, 4).join(" | ");
    return kurz.length > max ? `${kurz.slice(0, max - 1)}…` : kurz;
}

interface JsonFall {
    readonly fullName?: string;
    readonly title?: string;
    readonly status?: string;
    readonly failureMessages?: readonly string[];
}

interface JsonDatei {
    readonly name?: string;
    readonly status?: string;
    readonly message?: string;
    readonly startTime?: number;
    readonly endTime?: number;
    readonly assertionResults?: readonly JsonFall[];
}

/** Liest `--reporter=json` von Vitest: je Datei grün, rot oder ganz übersprungen. `wurzel` ist die Wurzel des Laufs (für relative Pfade). */
export function wertAus(json: unknown, wurzel: string): DateiErgebnis[] {
    const normal = (pfad: string): string => pfad.replace(/\\/g, "/");
    const basis = `${normal(wurzel).replace(/\/+$/, "")}/`;
    const dateien = (json as { testResults?: readonly JsonDatei[] } | null)?.testResults ?? [];
    return dateien.map((d): DateiErgebnis => {
        const name = normal(d.name ?? "");
        const datei = name.startsWith(basis) ? name.slice(basis.length) : name;
        const dauerMs = Math.max(0, Math.round((d.endTime ?? 0) - (d.startTime ?? 0)));
        const faelle = d.assertionResults ?? [];
        const rot = faelle.find((f) => f.status === "failed");
        if (rot !== undefined) {
            return {
                datei,
                status: "rot",
                test: rot.fullName ?? rot.title ?? "",
                meldung: ersteMeldung(rot.failureMessages ?? []),
                dauerMs,
            };
        }
        if (d.status === "failed") {
            return {
                datei,
                status: "rot",
                test: "(Datei: Hook oder Import)",
                meldung: ersteMeldung([d.message ?? ""]),
                dauerMs,
            };
        }
        const gelaufen = faelle.some((f) => f.status === "passed");
        return { datei, status: gelaufen ? "gruen" : "uebersprungen", dauerMs };
    });
}
