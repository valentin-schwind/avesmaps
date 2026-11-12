import { createHash, randomUUID } from "node:crypto";
import { constants, createWriteStream, statfsSync } from "node:fs";
import { access, mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
    ABZUG_TAR_MANIFEST,
    ABZUG_TAR_MEDIEN,
    istSichererMedienPfad,
    type AbzugManifest,
    type AbzugMedium,
    type AbzugProblem,
    type AbzugProblemCode,
} from "@avesmaps3d/shared";
import { EinspielenFehler } from "./fehler.ts";
import { tarStrom, type TarEintrag } from "./tar.ts";

/**
 * Die Mediendateien im Abzug (WI-0251, Vali 2026-10-24: „alle kartendaten auch“): Zu jeder Zeile von `media_file` liegt die Datei unter
 * `medien/<Schlüssel wie unter MEDIA_ROOT>` im Tar, mit Größe und SHA-256 im Manifest. Kartenserien (Kacheln unter `TILE_ROOT`) und private Belege
 * (`media_rights_evidence`) kommen nicht mit.
 *
 * Lokal geschieht das in drei Schritten, damit eine kaputte Datei nie eine halbe Welt hinterlässt:
 *
 * 1. **Prüfen, bevor etwas verändert wird:** Die Liste des Manifests gegen die Köpfe des Tars (`pruefeMedienListe`: sichere Pfade, jede Datei da und
 *    so groß wie genannt) und jede Datei einmal durch den Hash (`pruefeMedienStrom`).
 * 2. **Die Datenbank** wird in einer Transaktion ersetzt (`einspielen.ts`); dort stimmt `media_file` mit der Liste überein oder alles wird zurückgenommen.
 * 3. **Ablegen:** Nach dem Commit kommen die Dateien nach `MEDIA_ROOT`, jede zuerst in eine Temporärdatei im Zielordner (`fsync`), dann ein atomares
 *    `rename` (wie `media/storage.ts`). Was lokal schon mit gleicher Größe liegt, bleibt (der Schlüssel enthält die Prüfsumme des Inhalts); lokale
 *    Zusatzdateien werden nie gelöscht. Scheitert eine Datei, steht sie als `offen` im Ergebnis, und ein erneutes Einspielen derselben Datei holt
 *    sie nach.
 *
 * 🔴 Pfade kommen aus dem Manifest und sind damit fremde Eingabe: Jeder Pfad muss `istSichererMedienPfad` bestehen, das Ziel muss unter dem
 * aufgelösten `MEDIA_ROOT` bleiben (auch über Verknüpfungen), und geschrieben wird nur unter einem Zufallsnamen, der erst nach der Prüfung der Bytes
 * den Namen bekommt.
 */

/** Platz, der nach dem Ablegen frei bleiben soll (wie bei der Sicherung). */
export const MEDIEN_LUFT_BYTES = 1024 * 1024 * 1024;
const GLEICHZEITIG = 64;

export function medienTarName(pfad: string): string {
    return `${ABZUG_TAR_MEDIEN}${pfad}`;
}

export function problem(code: AbzugProblemCode, detail: string | null = null): AbzugProblem {
    return { code, detail };
}

/** Die ersten Namen einer Liste für eine Fundstelle: kurz, ohne einen langen Pfad ungekürzt in die Oberfläche zu tragen. */
export function erste(namen: readonly string[], genug = 3): string {
    const kurz = (name: string): string => (name.length > 90 ? `${name.slice(0, 87)}…` : name);
    return namen.length <= genug
        ? namen.map(kurz).join(", ")
        : `${namen.slice(0, genug).map(kurz).join(", ")} und ${String(namen.length - genug)} weitere`;
}

export interface MedienSumme {
    readonly dateien: number;
    readonly bytes: number;
    readonly fehlend: number;
}

export function medienSumme(manifest: Pick<AbzugManifest, "medien" | "medienFehlend">): MedienSumme {
    return {
        dateien: manifest.medien.length,
        bytes: manifest.medien.reduce((summe, medium) => summe + medium.groesse, 0),
        fehlend: manifest.medienFehlend.length,
    };
}

/**
 * Die Liste des Manifests gegen die Köpfe des Tars; reine Rechnung, ohne eine Datei zu lesen. Gibt die Befunde als Text zurück: `pfade`
 * (`medien_pfad`) und `dateien` (`datei`). Das Tar trägt genau das Manifest, die Tafeln des Manifests und die Mediendateien der Liste, sonst nichts.
 */
export function pruefeMedienListe(
    manifest: AbzugManifest,
    eintraege: readonly TarEintrag[],
): { pfade: string[]; dateien: string[] } {
    const pfade: string[] = [];
    const dateien: string[] = [];

    const unsicher = [...manifest.medien.map((medium) => medium.pfad), ...manifest.medienFehlend].filter(
        (pfad) => !istSichererMedienPfad(pfad),
    );
    if (unsicher.length > 0) pfade.push(`unzulässig: ${erste(unsicher)}`);
    const gesehen = new Set<string>();
    const doppelt: string[] = [];
    for (const pfad of [...manifest.medien.map((medium) => medium.pfad), ...manifest.medienFehlend]) {
        // Windows und macOS unterscheiden Groß- und Kleinschreibung nicht: Zwei Namen, die dort ein und dieselbe Datei wären, zählen als doppelt.
        const schluessel = pfad.toLowerCase();
        if (gesehen.has(schluessel)) doppelt.push(pfad);
        gesehen.add(schluessel);
    }
    if (doppelt.length > 0) pfade.push(`doppelt: ${erste(doppelt)}`);

    const imTar = new Map<string, TarEintrag>();
    const doppeltImTar: string[] = [];
    for (const eintrag of eintraege) {
        if (imTar.has(eintrag.name)) doppeltImTar.push(eintrag.name);
        imTar.set(eintrag.name, eintrag);
    }
    if (doppeltImTar.length > 0) dateien.push(`mehrfach im Abzug: ${erste(doppeltImTar)}`);
    const fehlt: string[] = [];
    const andereGroesse: string[] = [];
    for (const medium of manifest.medien) {
        const eintrag = imTar.get(medienTarName(medium.pfad));
        if (eintrag === undefined) fehlt.push(medienTarName(medium.pfad));
        else if (eintrag.groesse !== medium.groesse) andereGroesse.push(medienTarName(medium.pfad));
    }
    if (fehlt.length > 0) dateien.push(`fehlt im Abzug: ${erste(fehlt)}`);
    if (andereGroesse.length > 0) dateien.push(`andere Größe als im Manifest: ${erste(andereGroesse)}`);
    const erwartet = new Set<string>([
        ABZUG_TAR_MANIFEST,
        ...manifest.tafeln.map((tafel) => tafel.datei),
        ...manifest.medien.map((medium) => medienTarName(medium.pfad)),
    ]);
    const fremd = [...imTar.keys()].filter((name) => !erwartet.has(name));
    if (fremd.length > 0) dateien.push(`nicht im Manifest: ${erste(fremd)}`);
    return { pfade, dateien };
}

/** Das Ziel einer Datei unter der Medienwurzel; wirft, wenn der Pfad unsicher ist oder aus der Wurzel hinausführte. */
export function medienZiel(wurzel: string, pfad: string): string {
    if (!istSichererMedienPfad(pfad)) throw new Error("unzulässiger Pfad");
    const basis = resolve(wurzel);
    const ziel = resolve(basis, ...pfad.split("/"));
    const innen = relative(basis, ziel);
    if (innen === "" || innen.startsWith("..") || isAbsolute(innen))
        throw new Error("der Pfad führt aus der Medienwurzel");
    return ziel;
}

/** Freie Bytes auf dem Datenträger eines Ordners; `undefined`, wenn das Betriebssystem es nicht sagt. */
function freierPlatz(ordner: string): number | undefined {
    try {
        const info = statfsSync(ordner);
        return Number(info.bavail) * Number(info.bsize);
    } catch {
        return undefined;
    }
}

async function naechsterVorhandener(pfad: string): Promise<string | undefined> {
    let kandidat = pfad;
    for (let i = 0; i < 64; i += 1) {
        try {
            if ((await stat(kandidat)).isDirectory()) return kandidat;
            return undefined;
        } catch {
            const eltern = dirname(kandidat);
            if (eltern === kandidat) return undefined;
            kandidat = eltern;
        }
    }
    return undefined;
}

function liegtUnter(pfad: string, wurzelEcht: string): boolean {
    return pfad === wurzelEcht || pfad.startsWith(`${wurzelEcht}${sep}`);
}

/**
 * Legt einen Zielordner an, ohne je außerhalb der (aufgelösten) Medienwurzel etwas anzulegen: Erst muss der nächste vorhandene Ordner darüber
 * nach dem Auflösen von Verknüpfungen unter der Wurzel liegen, dann wird angelegt, dann gilt dasselbe für den fertigen Ordner.
 */
async function ordnerAnlegen(ordner: string, wurzelEcht: string): Promise<void> {
    const vorhanden = await naechsterVorhandener(ordner);
    if (vorhanden === undefined) throw new Error("an der Stelle des Zielordners liegt eine Datei");
    if (!liegtUnter(await realpath(vorhanden), wurzelEcht)) {
        throw new Error("der Zielordner führt über eine Verknüpfung aus der Medienwurzel");
    }
    await mkdir(ordner, { recursive: true });
    if (!liegtUnter(await realpath(ordner), wurzelEcht)) {
        throw new Error("der Zielordner führt über eine Verknüpfung aus der Medienwurzel");
    }
}

export interface MedienPlan {
    /** Die Dateien, die lokal fehlen oder eine andere Größe haben. */
    readonly zuSchreiben: readonly AbzugMedium[];
    /** Wie viele schon mit gleicher Größe liegen. */
    readonly vorhanden: number;
    /** Die Größe der zu schreibenden Dateien zusammen. */
    readonly bytes: number;
}

/** Was lokal fehlt oder abweicht: eine Datei gilt als vorhanden, wenn sie unter dem Schlüssel liegt und gleich groß ist. */
export async function planeMedien(wurzel: string, medien: readonly AbzugMedium[]): Promise<MedienPlan> {
    const zuSchreiben: AbzugMedium[] = [];
    let vorhanden = 0;
    for (let i = 0; i < medien.length; i += GLEICHZEITIG) {
        const teil = medien.slice(i, i + GLEICHZEITIG);
        const da = await Promise.all(
            teil.map(async (medium) => {
                try {
                    const info = await stat(medienZiel(wurzel, medium.pfad));
                    return info.isFile() && info.size === medium.groesse;
                } catch {
                    return false;
                }
            }),
        );
        teil.forEach((medium, index) => {
            if (da[index] === true) vorhanden += 1;
            else zuSchreiben.push(medium);
        });
    }
    return { zuSchreiben, vorhanden, bytes: zuSchreiben.reduce((summe, medium) => summe + medium.groesse, 0) };
}

/**
 * Die Voraussetzungen für das Ablegen, vor dem Einspielen: `MEDIA_ROOT` ist eingerichtet und beschreibbar, und der Datenträger hat Platz für
 * das, was lokal fehlt, plus Luft. Ohne Mediendateien im Abzug gibt es nichts zu prüfen.
 */
export async function pruefeMedienAblage(
    wurzel: string | undefined,
    manifest: Pick<AbzugManifest, "medien">,
): Promise<AbzugProblem[]> {
    if (manifest.medien.length === 0) return [];
    if (wurzel === undefined || wurzel.trim() === "") {
        return [problem("medien_ablage", "MEDIA_ROOT ist nicht gesetzt")];
    }
    // Ein unsicherer Pfad ist schon als medien_pfad gemeldet.
    if (manifest.medien.some((medium) => !istSichererMedienPfad(medium.pfad))) return [];
    const ort = await naechsterVorhandener(resolve(wurzel));
    if (ort === undefined) return [problem("medien_ablage", "MEDIA_ROOT liegt in keinem vorhandenen Ordner")];
    try {
        await access(ort, constants.W_OK);
    } catch {
        return [problem("medien_ablage", "MEDIA_ROOT ist nicht beschreibbar")];
    }
    const plan = await planeMedien(wurzel, manifest.medien);
    const frei = freierPlatz(ort);
    const noetig = plan.bytes + MEDIEN_LUFT_BYTES;
    if (frei !== undefined && frei < noetig) {
        const gb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1);
        return [problem("medien_platz", `frei ${gb(frei)} GB, nötig etwa ${gb(noetig)} GB`)];
    }
    return [];
}

/**
 * Liest jede Mediendatei einmal durch den Hash und vergleicht mit dem Manifest. Ändert nichts; scheitert mit `EinspielenFehler`, bevor die
 * Datenbank berührt wird.
 */
export async function pruefeMedienStrom(
    tarPfad: string,
    manifest: Pick<AbzugManifest, "medien">,
    eintraege: readonly TarEintrag[],
    fortschritt?: (anteil: number) => void,
): Promise<void> {
    const nachName = new Map(eintraege.map((eintrag) => [eintrag.name, eintrag] as const));
    const gesamt = manifest.medien.reduce((summe, medium) => summe + medium.groesse, 0);
    let fertig = 0;
    for (const medium of manifest.medien) {
        const eintrag = nachName.get(medienTarName(medium.pfad));
        if (eintrag === undefined || eintrag.groesse !== medium.groesse) {
            throw new EinspielenFehler(
                "datei",
                `Im Abzug fehlt die Mediendatei ${erste([medium.pfad])}. Nichts wurde verändert.`,
            );
        }
        const hash = createHash("sha256");
        let bytes = 0;
        try {
            for await (const stueck of tarStrom(tarPfad, eintrag)) {
                const teil = stueck as Buffer;
                hash.update(teil);
                bytes += teil.length;
            }
        } catch (error) {
            throw new EinspielenFehler(
                "datei",
                `Die Mediendatei ${erste([medium.pfad])} ließ sich nicht lesen (${error instanceof Error ? error.message.slice(0, 160) : String(error)}). Nichts wurde verändert.`,
            );
        }
        if (bytes !== medium.groesse || hash.digest("hex") !== medium.sha256) {
            throw new EinspielenFehler(
                "pruefsumme",
                `Die Prüfsumme der Mediendatei ${erste([medium.pfad])} stimmt nicht mit dem Manifest überein. Nichts wurde verändert.`,
            );
        }
        fertig += medium.groesse;
        fortschritt?.(gesamt === 0 ? 1 : fertig / gesamt);
    }
}

export interface MedienErgebnis {
    /** Dateien, die der Abzug trägt. */
    readonly dateien: number;
    /** Neu geschrieben (fehlten lokal oder hatten eine andere Größe). */
    readonly geschrieben: number;
    /** Schon lokal mit gleicher Größe vorhanden. */
    readonly vorhanden: number;
    /** Nicht abgelegt: ein Erneutes Einspielen derselben Datei holt sie nach. */
    readonly offen: number;
    /** Größe der neu geschriebenen Dateien zusammen. */
    readonly bytes: number;
    /** Der erste Fehler (für das Protokoll des Servers, nie für die Oberfläche). */
    readonly ersterFehler: string | null;
}

/** Schreibt eine Datei aus dem Tar atomar an ihr Ziel; prüft dabei Größe und Prüfsumme noch einmal. Wirft bei jedem Fehler und hinterlässt keine Temporärdatei. */
async function schreibeDatei(tarPfad: string, eintrag: TarEintrag, medium: AbzugMedium, ziel: string): Promise<void> {
    const temporaer = `${ziel}.${randomUUID()}.part`;
    const hash = createHash("sha256");
    let bytes = 0;
    const pruefer = new Transform({
        transform(stueck: Buffer, _kodierung, weiter) {
            hash.update(stueck);
            bytes += stueck.length;
            weiter(null, stueck);
        },
    });
    try {
        // `flush`: Die Bytes sind auf dem Datenträger (fsync), bevor die Datei ihren Namen bekommt.
        await pipeline(tarStrom(tarPfad, eintrag), pruefer, createWriteStream(temporaer, { flags: "wx", flush: true }));
    } catch (error) {
        await rm(temporaer, { force: true });
        throw error;
    }
    if (bytes !== medium.groesse || hash.digest("hex") !== medium.sha256) {
        await rm(temporaer, { force: true });
        throw new Error("Größe oder Prüfsumme stimmen nach dem Schreiben nicht");
    }
    try {
        await rename(temporaer, ziel);
    } catch (error) {
        await rm(temporaer, { force: true });
        throw error;
    }
}

/**
 * Legt die fehlenden Mediendateien nach `MEDIA_ROOT`. Wirft nie wegen einer einzelnen Datei: Eine, die scheitert, zählt als `offen`, die
 * übrigen werden weiter abgelegt. Bei vollem Datenträger (`ENOSPC`) gibt es keinen Sinn weiterzumachen; der Rest zählt als offen.
 */
export async function legeMedienAb(
    tarPfad: string,
    wurzel: string,
    manifest: Pick<AbzugManifest, "medien">,
    eintraege: readonly TarEintrag[],
    fortschritt?: (anteil: number) => void,
): Promise<MedienErgebnis> {
    const nachName = new Map(eintraege.map((eintrag) => [eintrag.name, eintrag] as const));
    const dateien = manifest.medien.length;
    let plan: MedienPlan;
    try {
        plan = await planeMedien(wurzel, manifest.medien);
    } catch (error) {
        return {
            dateien,
            geschrieben: 0,
            vorhanden: 0,
            offen: dateien,
            bytes: 0,
            ersterFehler: error instanceof Error ? error.message : String(error),
        };
    }
    let geschrieben = 0;
    let offen = 0;
    let geschriebeneBytes = 0;
    let erster: string | null = null;
    let fertigBytes = 0;
    const merke = (medium: AbzugMedium, error: unknown): void => {
        offen += 1;
        erster ??= `${medium.pfad}: ${error instanceof Error ? error.message : String(error)}`;
    };
    // Geprüfte Zielordner (Auflösung über Verknüpfungen): Jeder wird einmal angelegt und gegen die aufgelöste Wurzel gehalten.
    const geprueft = new Set<string>();
    let wurzelEcht: string;
    try {
        await mkdir(resolve(wurzel), { recursive: true });
        wurzelEcht = await realpath(resolve(wurzel));
    } catch (error) {
        return {
            dateien,
            geschrieben: 0,
            vorhanden: plan.vorhanden,
            offen: plan.zuSchreiben.length,
            bytes: 0,
            ersterFehler: error instanceof Error ? error.message : String(error),
        };
    }
    for (let index = 0; index < plan.zuSchreiben.length; index += 1) {
        const medium = plan.zuSchreiben[index]!;
        try {
            const eintrag = nachName.get(medienTarName(medium.pfad));
            if (eintrag === undefined || eintrag.groesse !== medium.groesse) throw new Error("fehlt im Abzug");
            const ziel = medienZiel(wurzel, medium.pfad);
            const ordner = dirname(ziel);
            if (!geprueft.has(ordner)) {
                await ordnerAnlegen(ordner, wurzelEcht);
                geprueft.add(ordner);
            }
            await schreibeDatei(tarPfad, eintrag, medium, ziel);
            geschrieben += 1;
            geschriebeneBytes += medium.groesse;
        } catch (error) {
            merke(medium, error);
            if ((error as { code?: unknown }).code === "ENOSPC") {
                offen += plan.zuSchreiben.length - index - 1;
                break;
            }
        }
        fertigBytes += medium.groesse;
        fortschritt?.(plan.bytes === 0 ? 1 : fertigBytes / plan.bytes);
    }
    return { dateien, geschrieben, vorhanden: plan.vorhanden, offen, bytes: geschriebeneBytes, ersterFehler: erster };
}
