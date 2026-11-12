import {
    WIKISYNC_BEREICHE,
    wikiNamespaceTafel,
    type WikiNamespaceTafel,
    type WikisyncBereich,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { leseNamespaceTafel } from "../kanon/tafel.ts";
import { wikiKonfiguration } from "../wiki/config.ts";
import { waehleDump } from "../wiki/dump/datei.ts";
import { bestimmeStand, dateiMerkmale, erzeugeManifest } from "../wiki/dump/manifest.ts";
import { sammleSeiten, type SeitenErgebnis } from "../wiki/dump/seiten-sammler.ts";
import type { GefundeneSeite, TitelErgebnis } from "../wiki/dump/titel-sammler.ts";
import { DumpFehler } from "../wiki/dump/xml.ts";
import {
    baueErgebnisse,
    ergaenzeBauwerkart,
    leseArtSeiten,
    leseKategorienJeSeite,
    ordneArten,
    seitenFuerKategorien,
} from "../wiki/kategorien/aus-datei.ts";
import { pruefeKategorienDatei, waehleKategorienDatei, type KategorienKopf } from "../wiki/kategorien/datei.ts";
import { istWikiTeilBereich } from "../wiki/kategorien/konstanten.ts";
import { haengeKategorienAn } from "../wiki/kategorien/plan.ts";
import { ausloeserVon, schreibeFehllauf, schreibeLauf, type LaufEingabe } from "../wiki/abgleich/ablage.ts";
import { reiheFolgeNachVorschauEin, type Folge } from "../wiki/abgleich/folge.ts";
import {
    ladeBekannteOrtArtikel,
    ladeBekannteTitel,
    ladeFlaechenTitel,
    ladeBelegteRegionArtikel,
    ladeLandmarkenAufDerKarte,
    ladeObjekteDesLaufs,
} from "../wiki/abgleich/lokal.ts";
import { ladeRegelKontext } from "../wiki/regeln/laden.ts";
import type { RegelKontext } from "../wiki/regeln/vorschlag.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { listenImDump } from "../wiki/abgleich/vorkommen-liste.ts";
import {
    WIKISYNC_PARSER_VERSION,
    berechnePlan,
    gesuchteTitelAus,
    type Plan,
    type PlanEingabe,
    type PlanObjekt,
} from "../wiki/abgleich/plan.ts";
import { berechneVorschau, gesuchteTitel, unbekannteNamensraeume, type Zuweisung } from "../wiki/vorschau/vergleich.ts";
import { ladeZuweisungen } from "../wiki/vorschau/zuweisungen.ts";
import { JobCancelled, JobFailure, JobStopped, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";
import { leseFolge } from "./wiki-folge.ts";

/**
 * Die zwei lesenden Aufträge des WikiSync (WI-0253 B-1, C): `wiki_dump_einlesen` und `wiki_vorschau`. Beide lesen eine Datei im Dump-Ordner
 * (`WIKI_DUMP_ROOT`, ein Dump für alle Umgebungen), rufen das Wiki nicht an und schreiben in keine Fachtafel; was sie liefern, ist das
 * Ergebnis des Auftrags (Zahlen und Befunde, keine Seitentexte). Welche Räume Inhalt sind und was sie kosten, sagt die Namensraum-Tafel der
 * Umgebung (B-2); ihre Revision steht im Ergebnis. Die Vorschau legt dazu ihren Lauf ab (C: `wikisync_lauf`, `wikisync_lauf_zeile`, Migration 0224);
 * das sind ihre eigenen Protokolltafeln, keine Fachtafeln.
 *
 * Eingabe (`input_ref`), streng geprüft: `wiki_dump_einlesen` höchstens `{ datei }`, ein reiner Dateiname im Dump-Ordner (ohne Namen gilt die jüngste
 * Datei); `wiki_vorschau` dazu `bereiche` (ohne Angabe alle), `ausgeloestVon` (der Name
 * der Person, die den Lauf ausgelöst hat) und `folge` (die Bereiche, die der verkettete Lauf danach übernimmt, WI-0253 §20).
 */

interface Eingabe {
    datei: string | undefined;
}

/** Die Namensraum-Tafel, nach der ein Auftrag rechnet, und woher sie kam: ihre Revision geht ins Ergebnis. */
export interface JobTafel {
    revision: number | null;
    quelle: "datenbank" | "vorgabe";
    namensraeume: WikiNamespaceTafel;
}

/**
 * Die Tafel der Umgebung (WI-0253 B-2; Koordination 2026-10-25: Manifest, Befunde und Vorschau lesen die Tafel der Umgebung, nicht die
 * statische Vorgabe). Ohne Datenbank im Auftrag (Tests, ein Werkzeug ohne Verbindung) und ohne die Tafel selbst (vor Migration 0223) gilt die
 * Vorgabe, `revision` ist dann `null`. Die Revision gehört ins Ergebnis: Ändert jemand die Tafel danach, weiß jeder Leser, dass diese
 * Vorschau nach einer anderen gerechnet wurde.
 */
async function ladeJobTafel(
    environment: NodeJS.ProcessEnv,
    ladeTafel: (() => Promise<JobTafel>) | undefined,
): Promise<JobTafel> {
    if (ladeTafel !== undefined) return ladeTafel();
    const vorgabe: JobTafel = { revision: null, quelle: "vorgabe", namensraeume: wikiNamespaceTafel() };
    if ((environment["JOBS_DATABASE_URL"] ?? environment["DATABASE_URL"]) === undefined) return vorgabe;
    return withJobDatabase(async (database: Queryable) => {
        const stand = await leseNamespaceTafel(database);
        return stand.revision === null
            ? vorgabe
            : { revision: stand.revision, quelle: "datenbank" as const, namensraeume: stand.namensraeume };
    });
}

/** Die Folge ließ sich nicht einreihen: Die Vorschau davor ist abgelegt und bleibt, es ist kein Fehllauf der Vorschau. */
class FolgeFehler extends Error {
    constructor(ursache: unknown) {
        super(ursache instanceof Error ? ursache.message : String(ursache));
    }
}

function fehlerAus(fehler: unknown): never {
    if (fehler instanceof DumpFehler) throw new JobFailure(fehler.code, fehler.message, false);
    throw fehler;
}

export function leseDumpEingabe(input: Record<string, unknown>): Eingabe {
    const unbekannt = Object.keys(input).filter((key) => key !== "datei");
    if (unbekannt.length > 0) {
        throw new JobFailure("input_invalid", `Wiki-Auftrag: unbekanntes Feld ${unbekannt.join(", ")}`, false);
    }
    const datei = input["datei"];
    if (datei !== undefined && typeof datei !== "string") {
        throw new JobFailure("input_invalid", 'Wiki-Auftrag: "datei" ist kein Text', false);
    }
    return { datei };
}

/** `wiki_dump_einlesen`: Manifest und Zählungen je Namensraum, dazu die Befunde (abgeschnittener Dump, Räume ohne Zeile in der Vorgabe). */
export async function runWikiDumpEinlesenJob(
    context: JobContext,
    deps: { environment?: NodeJS.ProcessEnv; ladeTafel?: () => Promise<JobTafel> } = {},
): Promise<Record<string, unknown>> {
    const eingabe = leseDumpEingabe(context.input);
    const umgebung = deps.environment ?? process.env;
    const konfig = wikiKonfiguration(umgebung);
    try {
        await context.beginPhase("lesen", 0.05);
        const pfad = await waehleDump(konfig.dumpWurzel, eingabe.datei);
        const tafel = await ladeJobTafel(umgebung, deps.ladeTafel);
        const manifest = await erzeugeManifest(pfad, {
            bzip2: konfig.bzip2,
            beiFortschritt: () => context.checkpoint(),
            tafel: tafel.namensraeume,
        });
        const befunde: Record<string, unknown>[] = manifest.namensraeume
            .filter((raum) => !raum.inTafel)
            .map((raum) => ({ code: "namensraum_unbekannt", nr: raum.nr, name: raum.name, seiten: raum.seiten }));
        if (!manifest.vollstaendig) befunde.unshift({ code: "dump_unvollstaendig" });
        return { manifest, befunde, tafel: { revision: tafel.revision, quelle: tafel.quelle } };
    } catch (fehler) {
        return fehlerAus(fehler);
    }
}

// ----------------------------------------------------------------------------------------------------------------------------
// wiki_vorschau
// ----------------------------------------------------------------------------------------------------------------------------

interface VorschauEingabe {
    datei: string | undefined;
    /** Die Bereiche des Abgleichs; ohne Angabe alle. */
    bereiche: WikisyncBereich[];
    /** Der Name der Person, die den Lauf ausgelöst hat (die Route der Systemsteuerung setzt ihn); sonst leer. */
    ausgeloestVon: string | undefined;
    /** Die Folge des verketteten Laufs („WikiSync starten“): Nach der Vorschau kommt die Übernahme dieser Bereiche. Ohne Angabe ist die Vorschau nur eine Vorschau. */
    folge: Folge | undefined;
}

function bereichsListe(wert: unknown, feld: string, leerErlaubt: boolean): WikisyncBereich[] | undefined {
    if (wert === undefined) return undefined;
    const bekannt = WIKISYNC_BEREICHE as readonly unknown[];
    if (
        !Array.isArray(wert) ||
        (!leerErlaubt && wert.length === 0) ||
        wert.some((eintrag) => !bekannt.includes(eintrag))
    ) {
        throw new JobFailure("input_invalid", `Wiki-Auftrag: "${feld}" ist keine Liste von Bereichen`, false);
    }
    return WIKISYNC_BEREICHE.filter((bereich) => wert.includes(bereich));
}

/**
 * Die Eingabe der Vorschau, streng geprüft: `datei`, `bereiche`, `ausgeloestVon`, `folge` – sonst nichts. 🔴 Welche Bereiche noch beim Legacy-Zug liegen, steht NICHT mehr in der
 * Eingabe: Das sagt `wiki/abgleich/schalter-lesen.ts` (fest: jeder Bereich mit angeschlossener Übernahme gehört dem WikiSync), und daraus kommt der Eigentümer `legacy` im Plan.
 */
export function leseVorschauEingabe(input: Record<string, unknown>): VorschauEingabe {
    const unbekannt = Object.keys(input).filter(
        (key) => !["datei", "bereiche", "ausgeloestVon", "folge"].includes(key),
    );
    if (unbekannt.length > 0) {
        throw new JobFailure("input_invalid", `Wiki-Auftrag: unbekanntes Feld ${unbekannt.join(", ")}`, false);
    }
    const { datei } = leseDumpEingabe(Object.fromEntries(Object.entries(input).filter(([key]) => key === "datei")));
    const von = input["ausgeloestVon"];
    if (von !== undefined && (typeof von !== "string" || von.trim() === "" || von.length > 80)) {
        throw new JobFailure("input_invalid", 'Wiki-Auftrag: "ausgeloestVon" ist kein Name', false);
    }
    return {
        datei,
        bereiche: bereichsListe(input["bereiche"], "bereiche", false) ?? [...WIKISYNC_BEREICHE],
        ausgeloestVon: von,
        folge: leseFolge(input["folge"]),
    };
}

/** Was `wiki_vorschau` aus der Datenbank und in sie braucht; ersetzbar, damit Tests die Datenbank oder den Dump allein prüfen können. */
export interface VorschauAblage {
    ladeObjekte(bereiche: readonly WikisyncBereich[]): Promise<PlanObjekt[]>;
    ladeBekannteTitel(): Promise<Set<string>>;
    /** Die Landschaften der Karte mit Wiki-Adresse (kleingeschriebene Titel): Ein Link auf sie meint eine Fläche (die Rollen der Ortszeilen der Vorkommen). Fehlt sie, gilt keine Fläche. */
    ladeFlaechenTitel?(): Promise<Set<string>>;
    /** Die Schlüssel der Artikel, die an einer Landmarke der Karte hängen (WI-0271 L7): Sie werden kein Kandidat. Fehlt sie, hängt keiner. */
    ladeLandmarkenAufDerKarte?(): Promise<Set<string>>;
    ladeBelegteRegionArtikel?(): Promise<Set<string>>;
    /** Die Schlüssel der Artikel, die die Karte oder Legacys Registry schon kennt (WI-0295): Sie werden kein Orts-Artikel. Fehlt sie, rechnet der Bereich `ort` keine Orts-Artikel. */
    ladeBekannteOrtArtikel?(): Promise<Set<string>>;
    /**
     * Die Flächen der Karte und die Begriffstafel der Umgebung für die Regelvorschläge der Vorkommen (WI-0253 §24). Fehlt sie (Tests ohne Datenbank), entstehen keine Vorschläge; die Vorschau selbst
     * rechnet wie bisher.
     */
    ladeRegelKontext?(): Promise<RegelKontext>;
    /** Die Bereiche, die in dieser Umgebung dem WikiSync gehören (fest: alle mit angeschlossener Übernahme); für alle anderen gibt es noch keine Übernahme. */
    ladeWikisyncBereiche(): Promise<ReadonlySet<WikisyncBereich>>;
    /** Schreibt den Lauf; liefert seine Nummer. */
    schreibe(eingabe: LaufEingabe): Promise<number>;
    schreibeFehllauf(
        eingabe: Pick<LaufEingabe, "bereiche" | "parserVersion" | "jobPublicId" | "ausgeloestVon" | "ausgeloestLabel">,
        fehler: string,
    ): Promise<void>;
    /** Der Auslöser des Auftrags (`job.actor_ref`). */
    ausloeser(jobPublicId: string): Promise<string | null>;
    /**
     * Reiht die Folge ein, wenn der Auftrag eine trägt (WI-0253 §20): die Übernahme der Bereiche aus der eben abgelegten Vorschau. Ein Bereich mit Kategorien, dessen Vorschau keine Kategorien-Datei
     * gelesen hat, wird nicht eingereiht (`ausstehend`). Fehlt sie (Tests ohne Datenbank), entsteht keine Folge.
     */
    reiheFolgeEin?(args: {
        vorschauLauf: number;
        folge: Folge;
        actorRef: string | null;
        ausgeloestVon: string | undefined;
        mapDomainId: string | null;
    }): Promise<{ uebernahme: WikisyncBereich[]; ausstehend: WikisyncBereich[] }>;
}

/** Die Ablage in der Datenbank des Prozesses (Jobs-Rolle). Jeder Aufruf öffnet und schließt seine Verbindung: Der Dump liest dazwischen Minuten. */
function datenbankAblage(): VorschauAblage {
    return {
        ladeObjekte: (bereiche) => withJobDatabase((database) => ladeObjekteDesLaufs(database, bereiche)),
        ladeBekannteTitel: () => withJobDatabase((database) => ladeBekannteTitel(database)),
        ladeFlaechenTitel: () => withJobDatabase((database) => ladeFlaechenTitel(database)),
        ladeLandmarkenAufDerKarte: () => withJobDatabase((database) => ladeLandmarkenAufDerKarte(database)),
        ladeBelegteRegionArtikel: () => withJobDatabase((database) => ladeBelegteRegionArtikel(database)),
        ladeBekannteOrtArtikel: () => withJobDatabase((database) => ladeBekannteOrtArtikel(database)),
        ladeRegelKontext: () => withJobDatabase((database) => ladeRegelKontext(database)),
        ladeWikisyncBereiche: () => withJobDatabase((database) => wikisyncBereiche(database)),
        schreibe: (eingabe) => withJobDatabase((database) => schreibeLauf(database, eingabe)),
        schreibeFehllauf: (eingabe, fehler) =>
            withJobDatabase((database) => schreibeFehllauf(database, eingabe, fehler)),
        ausloeser: (jobPublicId) =>
            withJobDatabase(async (database) => {
                const [zeile] = await database<{ actor_ref: string | null }[]>`
                    SELECT actor_ref FROM job WHERE public_id = ${jobPublicId}::uuid
                `;
                return zeile?.actor_ref ?? null;
            }),
        reiheFolgeEin: (args) => withJobDatabase((database: Database) => reiheFolgeNachVorschauEin(database, args)),
    };
}

/** Ein Ergebnis des Sammlers in der Form, die die Zahlen der Zuweisungen (B-1) lesen. */
function alsTitelErgebnis(dump: SeitenErgebnis): TitelErgebnis {
    const gefunden = new Map<string, GefundeneSeite>();
    for (const [titel, seiten] of dump.gefunden) {
        const erste = seiten[0];
        if (erste !== undefined) gefunden.set(titel, { ns: erste.ns, weiterleitung: erste.weiterleitung });
    }
    return {
        seiten: dump.seiten,
        vollstaendig: dump.vollstaendig,
        kopf: dump.kopf,
        neuesteRevision: dump.neuesteRevision,
        gefunden,
        namensraeume: dump.namensraeume,
    };
}

/** Ab wie vielen Tagen Abstand zwischen Dump und Kategorien-Datei die Vorschau einen Hinweis gibt (kein Halt). */
const KATEGORIEN_ABSTAND_HINWEIS_TAGE = 14;

/**
 * Die Kategorien-Datei der Vorschau (WI-0294): die jüngste im Dump-Ordner, vollständig geprüft. Fehlt sie, gibt es keine (`undefined`) und einen Befund; die Vorschau rechnet dann ohne Ortsgröße,
 * Bauwerkart und Kontinent. Eine abgeschnittene Datei ist ein Fehler des Auftrags (nie Teilergebnisse).
 */
async function pruefeKategorien(
    wurzel: string | undefined,
    befunde: Record<string, unknown>[],
): Promise<{ pfad: string; kopf: KategorienKopf & { stand: string } } | undefined> {
    let pfad: string;
    try {
        pfad = await waehleKategorienDatei(wurzel, undefined);
    } catch (fehler) {
        if (fehler instanceof DumpFehler && fehler.code === "kategorien_datei_fehlt") {
            befunde.push({ code: "kategorien_datei_fehlt" });
            return undefined;
        }
        return fehlerAus(fehler);
    }
    try {
        const kopf = await pruefeKategorienDatei(pfad);
        if (!kopf.vollstaendig || kopf.stand === null) {
            throw new JobFailure(
                "kategorien_unvollstaendig",
                `Die Kategorien-Datei ${kopf.datei} ist abgeschnitten (die Endzeile fehlt): Eine Vorschau darauf zählte Seiten als „ohne Kategorie“, die nur nicht gelesen wurden`,
                false,
            );
        }
        return { pfad, kopf: { ...kopf, stand: kopf.stand } };
    } catch (fehler) {
        return fehlerAus(fehler);
    }
}

/** Wie viele Tage zwischen dem Stand des Dumps und dem der Kategorien-Datei liegen (Betrag, ganze Tage); `null`, wenn einer unbekannt oder nicht lesbar ist. */
export function abstandInTagen(dumpStand: string | null, kategorienStand: string | null): number | null {
    if (dumpStand === null || kategorienStand === null) return null;
    const a = Date.parse(dumpStand);
    const b = Date.parse(kategorienStand);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.floor(Math.abs(a - b) / 86_400_000);
}

/**
 * `wiki_vorschau`: der Abgleich der Karte mit dem Dump (WI-0253 C). Liest die Zuordnungen und Felder der Karte, den Dump (ein Durchgang) und die Namensraum-Tafel
 * der Umgebung, rechnet die Planzeilen je Bereich (`wiki/abgleich/plan.ts`) und legt sie als Lauf ab (`wikisync_lauf`, `wikisync_lauf_zeile`). REIN EINE VORSCHAU:
 * Es wird in keine Fachtafel geschrieben und kein Wiki angerufen. Das Ergebnis des Auftrags nennt Quelle, Zahlen (die der Zuweisungen wie in B-1, dazu die des
 * Plans je Bereich) und die Befunde zum Dump.
 *
 * 🔴 Ortsgröße, Bauwerkart und Kontinent (die Bereiche Orte, Herrschaftsgebiete, Derographie) rechnet die Vorschau aus der Datei `dump_categorylinks.sql.gz` im selben Ordner (WI-0294): zwei kurze
 * Durchgänge über die Datei, verbunden mit dem XML-Dump über die Seitennummer. Die Datei ist gepinnt (Name, Prüfsumme, Stand der Endzeile, Zeilen). Fehlt sie, entstehen diese drei Felder nicht, die Vorschau
 * gelingt, und die Übernahme der drei Bereiche steht aus (`kategorien_datei_fehlt` im Ergebnis). Eine abgeschnittene Datei hält den Auftrag an (`kategorien_unvollstaendig`), Teilergebnisse gibt es nie.
 *
 * 🔴 Ein abgeschnittener Dump rechnet nichts: Er ließe jede Seite hinter der Bruchstelle als „nicht im Dump“ erscheinen. Ohne Datenbank im Auftrag (Tests, ein
 * Werkzeug ohne Verbindung) und ohne Ablage in `deps` entsteht kein Lauf (`lauf: null`); die Zahlen der Zuweisungen gibt es trotzdem.
 */
export async function runWikiVorschauJob(
    context: JobContext,
    deps: {
        environment?: NodeJS.ProcessEnv;
        ladeZuweisungen?: () => Promise<Zuweisung[]>;
        ladeTafel?: () => Promise<JobTafel>;
        ablage?: VorschauAblage;
    } = {},
): Promise<Record<string, unknown>> {
    const eingabe = leseVorschauEingabe(context.input);
    const umgebung = deps.environment ?? process.env;
    const konfig = wikiKonfiguration(umgebung);
    const mitDatenbank = (umgebung["JOBS_DATABASE_URL"] ?? umgebung["DATABASE_URL"]) !== undefined;
    const ablage = deps.ablage ?? (mitDatenbank ? datenbankAblage() : undefined);
    const lade =
        deps.ladeZuweisungen ??
        ((): Promise<Zuweisung[]> => withJobDatabase((database: Queryable) => ladeZuweisungen(database)));
    const kopf = {
        bereiche: eingabe.bereiche,
        parserVersion: WIKISYNC_PARSER_VERSION,
        jobPublicId: context.job.publicId,
        ausgeloestVon: null as string | null,
        ausgeloestLabel: eingabe.ausgeloestVon ?? null,
    };
    try {
        await context.beginPhase("zuweisungen", 0.05);
        const kategorienBefunde: Record<string, unknown>[] = [];
        const pfad = await waehleDump(konfig.dumpWurzel, eingabe.datei);
        const zuweisungen = await lade();
        const tafel = await ladeJobTafel(umgebung, deps.ladeTafel);
        const objekte = ablage === undefined ? [] : await ablage.ladeObjekte(eingabe.bereiche);
        const bekannt = ablage === undefined ? new Set<string>() : await ablage.ladeBekannteTitel();
        const flaechen = (await ablage?.ladeFlaechenTitel?.()) ?? new Set<string>();
        const landmarkenAufDerKarte = eingabe.bereiche.includes("gipfel")
            ? await ablage?.ladeLandmarkenAufDerKarte?.()
            : undefined;
        const belegteRegionArtikel = eingabe.bereiche.includes("region")
            ? await ablage?.ladeBelegteRegionArtikel?.()
            : undefined;
        const bekannteOrtArtikel = eingabe.bereiche.includes("ort")
            ? await ablage?.ladeBekannteOrtArtikel?.()
            : undefined;
        // Die Regelvorschläge gibt es nur mit dem Bereich vorkommen und einer Ablage, die die Flächen und die Begriffstafel liefert.
        const regelKontext = eingabe.bereiche.includes("vorkommen") ? await ablage?.ladeRegelKontext?.() : undefined;
        // Was dem WikiSync gehört, gibt seine wiki-eigenen Felder frei; was keine angeschlossene Übernahme hat, ist „nur Vorschau“ (Eigentümer `legacy`).
        const wikisync = ablage === undefined ? new Set<WikisyncBereich>() : await ablage.ladeWikisyncBereiche();
        const legacyBereiche = new Set(WIKISYNC_BEREICHE.filter((bereich) => !wikisync.has(bereich)));
        const gesucht = new Set<string>([
            ...zuweisungen.flatMap((zuweisung) => gesuchteTitel(zuweisung)),
            ...gesuchteTitelAus(objekte),
        ]);
        if (ablage !== undefined) {
            const ausloeser = ausloeserVon(await ablage.ausloeser(context.job.publicId));
            kopf.ausgeloestVon = ausloeser.von;
            kopf.ausgeloestLabel ??= ausloeser.label;
        }

        // Die Kategorien-Datei (WI-0294): geprüft, bevor der Dump gelesen wird; eine abgeschnittene hält den Auftrag an, bevor irgendetwas gerechnet ist. Objekte der Bereiche mit Kategorien ohne die
        // Wiki-Einträge ohne Fläche (die der Wiki-Teil nie hatte).
        const kategorienObjekte = objekte.filter(
            (objekt) =>
                istWikiTeilBereich(objekt.bereich) &&
                objekt.regionArtikel === undefined &&
                objekt.ortArtikel === undefined,
        );
        const braucheKategorien = eingabe.bereiche.some((bereich) => istWikiTeilBereich(bereich));
        await context.beginPhase("kategorien", 0.1);
        const kategorien = braucheKategorien ? await pruefeKategorien(konfig.dumpWurzel, kategorienBefunde) : undefined;
        const artSeiten =
            kategorien !== undefined && eingabe.bereiche.includes("ort") ? await leseArtSeiten(kategorien.pfad) : [];
        await context.checkpoint();

        await context.beginPhase("dump", 0.2);
        const merkmale = await dateiMerkmale(pfad);
        const dump = await sammleSeiten(pfad, gesucht, tafel.namensraeume, {
            bzip2: konfig.bzip2,
            beiFortschritt: () => context.checkpoint(),
            // Die Quellen brauchen die Produktseiten und Weiterleitungen des ganzen Dumps; der Durchgang bleibt einer.
            katalog: eingabe.bereiche.includes("quelle"),
            // Die Vorkommen brauchen die Auskunft über mögliche Linkziele (Rollen der Ortszeilen) und ihre Artikel; derselbe Durchgang.
            vorkommen: eingabe.bereiche.includes("vorkommen"),
            // Die Sprachen sind artikelzentriert (WI-0261 S3): Sie brauchen ALLE Sprachartikel mit Text, nicht nur die bekannten Adressen; derselbe Durchgang.
            sprachen: eingabe.bereiche.includes("sprachen"),
            // Die Landmarken sind ebenso artikelzentriert (WI-0271 L7); derselbe Durchgang.
            landmarken: eingabe.bereiche.includes("gipfel"),
            // Die Wiki-Einträge ohne Fläche ebenso (WI-0284); nur mit einer Ablage, die sagt, was belegt ist; derselbe Durchgang.
            regionArtikel: belegteRegionArtikel !== undefined,
            // Die Orts- und Bauwerk-Artikel ebenso (WI-0295), nur mit der Kategorien-Datei (Klasse, Art und Kontinent stehen dort) und einer Ablage, die sagt, was bekannt ist; derselbe Durchgang.
            ortArtikel: bekannteOrtArtikel !== undefined && kategorien !== undefined,
            // Die Seitennummern für die Kategorien-Datei: Titel der Kategorieseiten der Arten, Nummer der gesuchten Titel; derselbe Durchgang.
            ...(kategorien === undefined ? {} : { kategorien: { ids: new Set(artSeiten.map((seite) => seite.id)) } }),
        });
        if (!dump.vollstaendig) {
            throw new JobFailure(
                "dump_unvollstaendig",
                "Der Dump ist abgeschnitten: Eine Vorschau darauf zählte Seiten als fehlend, die nur nicht gelesen wurden",
                false,
            );
        }
        const stand = bestimmeStand(merkmale.datei, dump.neuesteRevision);
        // Liegen Dump und Kategorien-Datei weit auseinander, ist das ein Hinweis, kein Halt: Die Felder stammen dann aus zwei Ständen des Wikis.
        const abstand = abstandInTagen(stand.wert, kategorien?.kopf.stand ?? null);
        if (abstand !== null && abstand > KATEGORIEN_ABSTAND_HINWEIS_TAGE) {
            kategorienBefunde.push({ code: "kategorien_abstand", tage: abstand });
        }

        // Ortsgröße, Bauwerkart und Kontinent aus der Datei: die Kategorien der gesuchten Seiten, dann die reine Rechnung.
        let ergebnisseAusDatei: ReturnType<typeof baueErgebnisse> | undefined;
        let ortArtikel: PlanEingabe["ortArtikel"];
        if (kategorien !== undefined) {
            await context.beginPhase("kategorien_lesen", 0.75);
            const seiteJeTitel = dump.kategorien?.seiteJeTitel ?? new Map();
            // Die Seiten der Objekte und, im Bereich `ort`, die der Orts- und Bauwerk-Artikel (WI-0295): ein Durchgang über die Datei.
            const ids = seitenFuerKategorien(kategorienObjekte, seiteJeTitel);
            for (const seite of dump.ortArtikel ?? []) if (seite.id !== null) ids.add(seite.id);
            const kategorienJeSeite = await leseKategorienJeSeite(kategorien.pfad, ids);
            const { arten, ohneTitel } = ordneArten(artSeiten, dump.kategorien?.titelJeId ?? new Map());
            if (dump.ortArtikel !== undefined && bekannteOrtArtikel !== undefined) {
                const jeTitel = new Map<string, readonly string[]>();
                for (const seite of dump.ortArtikel) {
                    jeTitel.set(seite.titel, seite.id === null ? [] : (kategorienJeSeite.get(seite.id) ?? []));
                }
                ortArtikel = { kategorien: jeTitel, arten, bekannt: bekannteOrtArtikel };
            }
            if (ohneTitel > 0) kategorienBefunde.push({ code: "kategorien_art_ohne_titel", anzahl: ohneTitel });
            ergebnisseAusDatei = baueErgebnisse({ objekte: kategorienObjekte, seiteJeTitel, kategorienJeSeite, arten });
            // Ohne passende Kategorie die Art der Infobox Bauwerk (WI-0295 T1, Legacys Rückfall im Dump-Pfad), aus dem Text, den der Durchgang ohnehin hält.
            ergebnisseAusDatei.ort.bauwerkart = ergaenzeBauwerkart(
                ergebnisseAusDatei.ort.bauwerkart,
                kategorienObjekte,
                dump.gefunden,
            );
        }

        await context.beginPhase("vergleichen", 0.8);
        const titelErgebnis = alsTitelErgebnis(dump);
        const plan = berechnePlan({
            bereiche: eingabe.bereiche,
            objekte,
            dump,
            tafel: tafel.namensraeume,
            legacyBereiche,
            bekannteTitel: bekannt,
            flaechen,
            ...(landmarkenAufDerKarte === undefined ? {} : { landmarkenAufDerKarte }),
            ...(belegteRegionArtikel === undefined ? {} : { belegteRegionArtikel }),
            ...(ortArtikel === undefined ? {} : { ortArtikel }),
            ...(dump.katalog === undefined ? {} : { katalog: dump.katalog }),
            ...(regelKontext === undefined ? {} : { regeln: regelKontext }),
            // Die Unterseiten „Liste“ der Vorkommen (WI-0299): Der Durchgang hat sie mit den Artikeln gesucht (`gesuchteTitelAus`).
            ...(eingabe.bereiche.includes("vorkommen") ? { listen: listenImDump(dump.gefunden) } : {}),
        });
        if (ergebnisseAusDatei !== undefined) {
            haengeKategorienAn(plan, {
                bereiche: eingabe.bereiche,
                objekte: kategorienObjekte,
                ergebnisse: ergebnisseAusDatei,
                legacyBereiche,
            });
        }

        let lauf: { id: number; bereiche: WikisyncBereich[]; zeilen: number; zahlen: Plan["zahlen"] } | null = null;
        if (ablage !== undefined) {
            await context.beginPhase("ablegen", 0.95);
            const id = await ablage.schreibe({
                ...kopf,
                quelle: {
                    datei: merkmale.datei,
                    sha256: merkmale.sha256,
                    stand: stand.wert,
                    seiten: dump.seiten,
                    kategorien:
                        kategorien === undefined || kategorien.kopf.stand === null
                            ? null
                            : {
                                  datei: kategorien.kopf.datei,
                                  sha256: kategorien.kopf.sha256,
                                  stand: kategorien.kopf.stand,
                                  zeilen: kategorien.kopf.zeilen,
                              },
                },
                tafelRevision: tafel.revision,
                plan,
                ...(regelKontext === undefined ? {} : { begriffeRevision: regelKontext.begriffeRevision }),
            });
            lauf = { id, bereiche: eingabe.bereiche, zeilen: plan.zeilen.length, zahlen: plan.zahlen };
        }
        // Die Folge des verketteten Laufs (WI-0253 §20): Alle Bereiche gehen aus DIESER Vorschau in die Übernahme; die mit Kategorien nur, wenn die Vorschau eine Kategorien-Datei gelesen hat.
        let folge: { uebernahme: WikisyncBereich[]; ausstehend: WikisyncBereich[] } | null = null;
        if (eingabe.folge !== undefined && lauf !== null && ablage?.reiheFolgeEin !== undefined) {
            await context.beginPhase("folge", 0.98);
            const actorRef = await ablage.ausloeser(context.job.publicId);
            try {
                folge = await ablage.reiheFolgeEin({
                    vorschauLauf: lauf.id,
                    folge: eingabe.folge,
                    actorRef,
                    ausgeloestVon: eingabe.ausgeloestVon,
                    mapDomainId: context.job.mapDomainId,
                });
            } catch (fehler) {
                // Die Vorschau steht; was nicht eingereiht werden konnte, ist ein Fehler des Auftrags (wiederholbar), kein Fehllauf der Vorschau.
                throw new FolgeFehler(fehler);
            }
        }
        return {
            quelle: {
                ...merkmale,
                stand,
                seiten: dump.seiten,
                // Die Kategorien-Datei der Vorschau (WI-0294); `null`: keine gelesen (nicht gebraucht oder nicht da).
                kategorien:
                    kategorien === undefined
                        ? null
                        : {
                              datei: kategorien.kopf.datei,
                              sha256: kategorien.kopf.sha256,
                              stand: kategorien.kopf.stand,
                              zeilen: kategorien.kopf.zeilen,
                          },
            },
            zahlen: berechneVorschau(zuweisungen, titelErgebnis),
            befunde: [...unbekannteNamensraeume(titelErgebnis, tafel.namensraeume), ...kategorienBefunde],
            // Nach welcher Tafel gerechnet wurde: Ändert sich ihre Revision, ist diese Vorschau veraltet.
            tafel: { revision: tafel.revision, quelle: tafel.quelle },
            lauf,
            ...(folge === null ? {} : { folge }),
        };
    } catch (fehler) {
        if (fehler instanceof FolgeFehler) {
            throw new JobFailure(
                "folge_fehlgeschlagen",
                `Die Vorschau steht, aber der Rest des Laufs ließ sich nicht einreihen: ${fehler.message}`,
                true,
            );
        }
        // Der Bericht zeigt einen Ausfall, statt zu schweigen; schlägt auch das fehl, bleibt der Fehler des Auftrags.
        if (ablage !== undefined && !(fehler instanceof JobCancelled) && !(fehler instanceof JobStopped)) {
            const grund = fehler instanceof Error ? fehler.message : String(fehler);
            await ablage.schreibeFehllauf(kopf, grund).catch(() => undefined);
        }
        return fehlerAus(fehler);
    }
}
