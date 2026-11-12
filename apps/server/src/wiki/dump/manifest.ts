import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { wikiNamespaceTafel, wikiNamespaceZeile, type WikiKanon, type WikiNamespaceTafel } from "@avesmaps3d/shared";
import { leseDump } from "./leser.ts";
import type { DumpKopf } from "./xml.ts";

/**
 * Das Manifest eines Wiki-Dumps (WI-0253 B-1, §3 Punkt 2: der Quellenstand ist belegbar): Datei, Größe, SHA-256, Stand des Dumps und die
 * Zählung je Namensraum. Es entsteht in einem Durchgang über den Dump ohne Text und steht als Ergebnis im Auftrag `wiki_dump_einlesen`;
 * `wiki_vorschau` und die späteren Abgleiche nennen dieselbe Prüfsumme als ihre Quelle.
 *
 * Der Stand des Dumps ist, was das Wiki selbst sagt, nie die Uhr dieses Rechners: ein Datum im Dateinamen (`dewa_dump_small_20261001.xml.bz2`),
 * sonst die jüngste Revision im Dump. Gibt es beides nicht, ist er unbekannt (`null`), nicht „heute“. Das Wiki erstellt den Dump zum
 * Monatsanfang; „geholt am“ steht dem Betreiber in der Dateizeit, nicht hier.
 */

export interface DateiMerkmale {
    /** Nur der Dateiname, nie ein Pfad. */
    datei: string;
    groesse: number;
    sha256: string;
}

export interface NamensraumZaehlung {
    nr: number;
    /** Der Name aus dem Kopf des Dumps; `""` im Hauptraum, `null`, wenn der Kopf ihn nicht nennt. */
    name: string | null;
    seiten: number;
    weiterleitungen: number;
    /** Steht der Raum in der Tafel der Umgebung? Sonst ist er KEIN Inhalt (und ein Befund im Dump-Bericht). */
    inTafel: boolean;
    /** Offiziell oder inoffiziell; `null`: kein Inhaltsraum, die Frage stellt sich nicht. */
    kanon: WikiKanon | null;
    traegtKartenobjekte: boolean;
}

export interface DumpStand {
    /** ISO-Datum (`2026-10-01`) oder ISO-Zeit; `null`: unbekannt. */
    wert: string | null;
    quelle: "dateiname" | "neueste-revision" | null;
}

export interface DumpManifest extends DateiMerkmale {
    stand: DumpStand;
    /** Wurde `</mediawiki>` gelesen? Ein abgeschnittener Dump ist kein kleiner Dump. */
    vollstaendig: boolean;
    seiten: number;
    weiterleitungen: number;
    neuesteRevision: string | null;
    wiki: { sitename: string | null; dbname: string | null; generator: string | null } | null;
    namensraeume: NamensraumZaehlung[];
}

/** Größe und SHA-256 der Datei in einem Strom. */
export async function dateiMerkmale(pfad: string): Promise<DateiMerkmale> {
    const hash = createHash("sha256");
    for await (const stueck of createReadStream(pfad)) hash.update(stueck as Buffer);
    return { datei: basename(pfad), groesse: (await stat(pfad)).size, sha256: hash.digest("hex") };
}

/** Ein Datum `JJJJMMTT` (auch mit `-` oder `_` dazwischen) aus dem Dateinamen; `null`, wenn keins drinsteht. */
export function standAusDateiname(datei: string): string | null {
    const treffer = /(?<!\d)(20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])(?!\d)/u.exec(datei);
    return treffer === null ? null : `${treffer[1] ?? ""}-${treffer[2] ?? ""}-${treffer[3] ?? ""}`;
}

/** Der Stand des Dumps: ein Datum im Dateinamen, sonst die jüngste Revision; sonst unbekannt. */
export function bestimmeStand(datei: string, neuesteRevision: string | null): DumpStand {
    const ausDateiname = standAusDateiname(datei);
    if (ausDateiname !== null) return { wert: ausDateiname, quelle: "dateiname" };
    if (neuesteRevision !== null) return { wert: neuesteRevision, quelle: "neueste-revision" };
    return { wert: null, quelle: null };
}

export interface ManifestOptionen {
    bzip2?: string | undefined;
    /** Wird nach jeder tausendsten Seite gerufen (Abbruch, Anhalten); wirft der Aufrufer, endet das Lesen. */
    beiFortschritt?: ((seiten: number) => void) | undefined;
    /** Die Namensraum-Tafel DIESER Umgebung (B-2, `kanon/tafel.ts`); ohne Angabe die Vorgabe. */
    tafel?: WikiNamespaceTafel | undefined;
}

export async function erzeugeManifest(pfad: string, optionen: ManifestOptionen = {}): Promise<DumpManifest> {
    const merkmale = await dateiMerkmale(pfad);
    const zaehlung = new Map<number, { seiten: number; weiterleitungen: number }>();
    let kopf: DumpKopf | null = null;
    let vollstaendig = false;
    let seiten = 0;
    let weiterleitungen = 0;
    let neueste: string | null = null;
    for await (const teil of leseDump(pfad, { mitText: false, bzip2: optionen.bzip2 })) {
        if (teil.art === "kopf") {
            kopf = teil.kopf;
        } else if (teil.art === "ende") {
            vollstaendig = teil.vollstaendig;
        } else {
            const { seite } = teil;
            const eintrag = zaehlung.get(seite.ns) ?? { seiten: 0, weiterleitungen: 0 };
            eintrag.seiten += 1;
            seiten += 1;
            if (seite.weiterleitung !== null) {
                eintrag.weiterleitungen += 1;
                weiterleitungen += 1;
            }
            zaehlung.set(seite.ns, eintrag);
            // ISO-Zeiten mit gleichem Aufbau sind als Text vergleichbar.
            const zeit = seite.revision?.zeit ?? null;
            if (zeit !== null && (neueste === null || zeit > neueste)) neueste = zeit;
            if (seiten % 1000 === 0) optionen.beiFortschritt?.(seiten);
        }
    }
    const tafel = optionen.tafel ?? wikiNamespaceTafel();
    const zeile = (nr: number) => wikiNamespaceZeile(tafel, nr);
    const namensraeume = [...zaehlung.entries()]
        .sort(([links], [rechts]) => links - rechts)
        .map(([nr, werte]): NamensraumZaehlung => ({
            nr,
            name: kopf?.namensraeume[nr] ?? null,
            seiten: werte.seiten,
            weiterleitungen: werte.weiterleitungen,
            inTafel: zeile(nr) !== undefined,
            kanon: zeile(nr)?.kanon ?? null,
            traegtKartenobjekte: zeile(nr)?.einsammeln ?? false,
        }));
    return {
        ...merkmale,
        stand: bestimmeStand(merkmale.datei, neueste),
        vollstaendig,
        seiten,
        weiterleitungen,
        neuesteRevision: neueste,
        wiki: kopf === null ? null : { sitename: kopf.sitename, dbname: kopf.dbname, generator: kopf.generator },
        namensraeume,
    };
}
