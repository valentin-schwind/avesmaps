import {
    KANAL_MIT_ZUGANG,
    ZAEHLREGELN,
    fassungFuer,
    mastodonRegel,
    zaehleKanal,
    type KanalMitZugang,
    type MastodonGrenzen,
} from "@avesmaps3d/shared";
import { isDatabaseUnavailable, type Queryable } from "../database.ts";
import {
    SOCIAL_SENDEN_KIND,
    leseDiscordZugang,
    leseMastodonZugang,
    leseMetaZugang,
    type DiscordZugang,
    type MastodonZugang,
    type MetaZugang,
} from "../community/social/kanaele/konfiguration.ts";
import * as discord from "../community/social/kanaele/discord.ts";
import * as facebook from "../community/social/kanaele/facebook.ts";
import * as instagram from "../community/social/kanaele/instagram.ts";
import {
    MastodonFehler,
    ladeBildHoch,
    nimmZurueck,
    sende,
    type MastodonDeps,
} from "../community/social/kanaele/mastodon.ts";
import { MetaFehler, type GraphDeps } from "../community/social/kanaele/meta-graph.ts";
import { grenzenAusTafel } from "../community/social/kanaele/stand.ts";
import { rechneBeitragsbild } from "../community/social/beitrag-bild.ts";
import { socialBildUrteile, type SocialBildUrteil } from "../community/social/bild-urteil.ts";
import { InstagramBildFehler } from "../community/social/instagram-bild.ts";
import { medienAblage, sichereInstagramBild, type InstagramAblage } from "../community/social/instagram-ableitung.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";

/**
 * Die Jobart `social_senden` (WI-0268 C12a und C12b; Fachkonzept §15.4 und §15.7): EINEN Beitrag des Social Hubs an einen fremden Kanal (Mastodon, Facebook, Instagram, Discord) senden oder dort zurücknehmen. Die Route reiht
 * sie in derselben Transaktion ein, die die Sendung vormerkt (Freigeben, Erneut senden, Zurücknehmen); Eingabe `{ beitrag, kanal }`, sonst nichts, damit kein Text in der Tafel der Aufträge landet. Der Kanal ist ein
 * Teil des Auftrags: Es gibt keine eigene Jobart je Kanal.
 *
 * - **Ablauf:** `social_senden_holen` reserviert die Sendung (nur wenn eine Aufgabe aussteht und gerade kein anderer Versuch läuft) und liefert Text, Hashtags, Bild, Kennung gegen Doppeltes und die Grenzen; der Aufruf
 *   des Dienstes geht über `community/social/kanaele/{mastodon,facebook,instagram,discord}.ts`; `social_senden_ergebnis` trägt den Ausgang ein. Die Jobs-Rolle hat an den Tafeln kein Recht (`db/community-grants.psql`), nur an diesen
 *   zwei Funktionen.
 * - 🔴 **Nie doppelt senden:** Eine Sendung, die nicht (mehr) ansteht, wird übersprungen. Zwei gleichzeitige Aufträge: nur einer bekommt die Reservierung. Stirbt der Auftrag nach dem Senden und vor dem Eintrag, sendet der
 *   nächste nach Ablauf der Reservierung noch einmal - bei Mastodon mit derselben `Idempotency-Key`, die die Instanz als denselben Beitrag erkennt. **Meta kennt keinen solchen Kopf:** Facebook und Instagram prüfen vor dem
 *   Senden, ob die Sendung schon eine Kennung bei Meta hat (`extern_id`), und senden dann nicht; Instagram trägt die Kennung des Containers nach Schritt 1 als Zwischenstand ein (`zwischen`), damit ein neuer Versuch
 *   keinen zweiten Container und keinen zweiten Beitrag anlegt. **Ein Webhook von Discord kennt auch keinen:** Er prüft wie Facebook die Kennung und schickt keinen zweiten Versuch, wenn beim Senden die Antwort ausblieb (`kanaele/discord.ts`).
 * - 🔴 **Gesendet wird nur, was mit derselben Regel nachgezählt ist:** Der Auftrag zählt Text und Hashtags noch einmal (Mastodon mit den gespeicherten Grenzen der Instanz, Facebook und Instagram mit der Regel des Hubs,
 *   `social/zaehlen.ts`). Er sendet nicht, wenn der Notschalter steht, die Zählregel nicht geprüft ist, die Rechte des Bildes keinen Beitrag (mehr) zulassen (`bild-urteil.ts`), Instagram kein öffentlich erreichbares Bild hat oder die Umgebung
 *   den Kanal nicht kennt: Das Ziel steht dann auf „Fehler“ mit dem Grund (Erneut senden bleibt möglich). Das Zurücknehmen hält der Notschalter nicht an.
 * - 🔴 **Instagram nimmt nur JPEG:** Meta holt das Bild selbst von einer öffentlichen Adresse ab und akzeptiert dort kein WebP. Der Auftrag legt darum VOR dem Container die JPEG-Fassung neben die veröffentlichte WebP
 *   (`published/sha256/aa/bb/<hash>.ig.jpg`, `social/instagram-ableitung.ts`; liegt sie schon da, wird sie genommen) und nennt Meta ihre Adresse. Dafür braucht der Job-Prozess Schreibrecht unter `MEDIA_ROOT/published`. Facebook
 *   lädt die Bytes der WebP selbst hoch und ist davon nicht berührt.
 * - 🔴 **Instagram nimmt nichts zurück:** Es gibt über die Schnittstelle kein Löschen. Die Datenbank weist das Zurücknehmen schon ab; käme es trotzdem als Auftrag an, endet es mit dem Satz „bitte in der App löschen“.
 * - **Vorübergehender Fehler:** höchstens drei Versuche mit Abstand (1 Minute, 5 Minuten): Der Auftrag trägt den Fehlversuch ein und reiht sich mit `not_before` neu ein. Der dritte Fehlversuch und jeder dauerhafte
 *   Fehler (Schlüssel abgelehnt, Beitrag abgelehnt) machen das Ziel `fehler`, mit kurzem Satz ohne Zugangsschlüssel und ohne Adresse des Dienstes.
 * - 🔴 **Nie Text, Schlüssel oder Adresse im Ergebnis des Auftrags:** Es trägt Kennung des Beitrags, Kanal, Zustand und Versuche.
 * - **Ein Ausfall des Kanals ändert nichts an Avesmaps:** Die Neuigkeit des Beitrags liegt längst in `news_entry`; dieser Auftrag berührt sie nie. Fällt ein Kanal aus, senden die anderen weiter (jeder Kanal ist ein
 *   eigener Auftrag).
 */

export { SOCIAL_SENDEN_KIND };

/** Wie lange zwischen dem 1. und 2. und dem 2. und 3. Versuch gewartet wird (Millisekunden). */
export const SENDEN_ABSTAENDE_MS: readonly number[] = [60_000, 300_000];

/** Wie lange nach einer fremden Reservierung noch einmal nachgesehen wird: knapp nach ihrem Ablauf (3 Minuten). */
const NACHSEHEN_MS = 4 * 60_000;

function ungueltig(grund: string): JobFailure {
    return new JobFailure("input_invalid", `Social senden: ${grund}`, false);
}

/** Prüft die Eingabe streng: genau `{ beitrag: <positive ganze Zahl>, kanal: <Kanal mit Zugang> }`. */
export function leseSendenAuftrag(input: Record<string, unknown>): { beitrag: number; kanal: KanalMitZugang } {
    const unbekannt = Object.keys(input).filter((key) => key !== "beitrag" && key !== "kanal");
    if (unbekannt.length > 0) throw ungueltig(`unbekanntes Feld ${unbekannt.join(", ")}`);
    const beitrag = input["beitrag"];
    if (typeof beitrag !== "number" || !Number.isSafeInteger(beitrag) || beitrag < 1)
        throw ungueltig('"beitrag" ist keine Kennung');
    const kanal = KANAL_MIT_ZUGANG.find((k) => k === input["kanal"]);
    if (kanal === undefined) throw ungueltig('"kanal" ist kein Kanal mit Zugang');
    return { beitrag, kanal };
}

interface Geholt {
    /** Die Sendung steht an, aber ein anderer Versuch hält gerade die Reservierung (oder starb mitten im Senden): später noch einmal nachsehen. */
    reserviert?: true;
    aufgabe: "senden" | "zuruecknehmen";
    nummer: string;
    /** Die Titelzeile (seit Migration 0300; nur Discord zeigt sie außerhalb der Neuigkeiten). */
    titel?: string | null;
    text: string;
    hashtags: string[];
    bild: string | null;
    bildBeschreibung: string | null;
    bildFrei: boolean;
    bildDatei: { schluessel: string; mime: string; bytes: number } | null;
    idempotenz: string;
    externId: string | null;
    versuche: number;
    serie: number;
    notschalter: boolean;
    freigeschaltet: boolean;
    grenzen: unknown;
    grenzenAt: string | null;
}

interface Stand {
    zustand: "wartet" | "ok" | "fehler" | "zurueck";
    aufgabe: "senden" | "zuruecknehmen" | null;
    versuche: number;
}

type Ergebnis = "gesendet" | "zurueckgenommen" | "vorlaeufig" | "fehler" | "zwischen";

/** Was der Auftrag zum Lesen der Bilddatei braucht; Tests geben eine eigene. */
export interface BildQuelle {
    read(schluessel: string, maxBytes: number): Promise<Uint8Array>;
}

export interface SocialSendenAbhaengigkeiten extends MastodonDeps, GraphDeps, discord.DiscordDeps {
    /** Die Datenbank des Auftrags (Jobs-Rolle); Tests geben ihre Verbindung. */
    database?: Queryable;
    environment?: NodeJS.ProcessEnv;
    /** Die Medienablage zum Lesen (sonst `MEDIA_ROOT` der Umgebung). */
    bilder?: BildQuelle;
    /** Die Medienablage für die Instagram-Fassung: lesen und schreiben (sonst `MEDIA_ROOT` der Umgebung). */
    ablage?: InstagramAblage;
    /** Die Zeit; Tests frieren sie ein. */
    jetzt?: () => Date;
}

async function holen(db: Queryable, beitrag: number, kanal: string): Promise<Geholt | null> {
    const [row] = await db<{ geholt: Geholt | null }[]>`
        SELECT avesmaps_community.social_senden_holen(${beitrag}::bigint, ${kanal}) AS geholt
    `;
    return row?.geholt ?? null;
}

async function eintragen(
    db: Queryable,
    beitrag: number,
    kanal: string,
    ergebnis: Ergebnis,
    externId: string | null,
    adresse: string | null,
    grund: string | null,
): Promise<Stand | null> {
    const [row] = await db<{ stand: Stand | null }[]>`
        SELECT avesmaps_community.social_senden_ergebnis(${beitrag}::bigint, ${kanal}, ${ergebnis}, ${externId}, ${adresse}, ${grund}) AS stand
    `;
    return row?.stand ?? null;
}

/** Reiht den nächsten Versuch ein (`job_enqueue`, SECURITY DEFINER; ohne Fußabdruck auf der Karte). */
async function reiheNachfolgerEin(
    db: Queryable,
    kontext: JobContext,
    beitrag: number,
    kanal: string,
    notBefore: Date,
): Promise<void> {
    const domain = kontext.job.mapDomainId;
    if (domain === null) throw new JobFailure("domain_missing", "Der Job nennt keine Kartendomäne", false);
    try {
        await db`
            SELECT public_id::text AS public_id
              FROM job_enqueue(
                       ${SOCIAL_SENDEN_KIND}, 1::smallint, ${domain}, 'community', ${db.json({ beitrag, kanal })}::jsonb, 50::smallint,
                       ${notBefore}::timestamptz, 'tiles', '{}'::smallint[]
                   )
        `;
    } catch (fehler) {
        // Das Einreihen scheiterte: Die Sendung steht an, der Auftrag läuft noch einmal (die Reservierung ist frei).
        void fehler;
        throw new JobFailure("einreihen_fehlgeschlagen", "Der nächste Versuch konnte nicht eingereiht werden", true);
    }
}

/** Ein dauerhafter Fehler vor dem Aufruf des Dienstes: der Satz für das Ziel. */
class Vorabfehler extends Error {}
/** Die öffentliche Fassung fehlt noch: Gleich nach dem Bestätigen der Rechte rechnet der Abgleich sie vielleicht gerade (WI-0278). Das ist vorübergehend, der Auftrag versucht es wieder. */
class BildWartet extends Error {}

function pruefeVorab(geholt: Geholt, grenzen: MastodonGrenzen | null): MastodonGrenzen {
    if (geholt.notschalter) throw new Vorabfehler("Der Notschalter steht an: nichts gesendet");
    if (!geholt.freigeschaltet || grenzen === null) {
        throw new Vorabfehler("Die Zählregel des Kanals ist noch nicht geprüft");
    }
    return grenzen;
}

/**
 * Zählt noch einmal mit der Regel des Hubs und den Grenzen des Dienstes; wirft, wenn etwas überläuft. Gibt den Text zurück, wie er hinausgeht. Mastodon zählt mit den Grenzen der Instanz, Facebook und Instagram
 * mit ihrer Zeile in `ZAEHLREGELN` (Meta nennt keine Grenzen).
 */
function textFuer(kanal: KanalMitZugang, geholt: Geholt, grenzen: MastodonGrenzen): string {
    const regel =
        kanal === "mastodon"
            ? mastodonRegel(grenzen, (geholt.grenzenAt ?? "").slice(0, 10) || "unbekannt")
            : ZAEHLREGELN[kanal];
    const eingabe = { text: geholt.text, hashtags: geholt.hashtags };
    const stand = zaehleKanal(kanal, eingabe, { [kanal]: regel });
    if (stand.ueber)
        throw new Vorabfehler(
            `Der Text ist für ${dienstName(kanal, false)} zu lang (${String(stand.zuviel)} Zeichen zu viel)`,
        );
    const fassung = fassungFuer(regel, eingabe);
    if (fassung.text.trim() === "") throw new Vorabfehler("Der Text fehlt");
    return fassung.text;
}

/** Darf das Bild hinaus (dieselbe Entscheidung wie Auswahl und Freigabe, `bild-urteil.ts`), und passt seine Beschreibung? Gibt das Urteil und die Beschreibung zurück. */
async function pruefeFreigabe(
    db: Queryable,
    geholt: Geholt,
    grenzen: MastodonGrenzen,
    kanal: KanalMitZugang,
): Promise<{ urteil: SocialBildUrteil; beschreibung: string }> {
    const urteil = (await socialBildUrteile(db, [geholt.bild ?? ""])).get(geholt.bild ?? "");
    if (urteil === undefined || !urteil.erlaubt) {
        throw new Vorabfehler("Die Rechte des Bildes lassen keinen Beitrag (mehr) zu oder es ist ausgeblendet");
    }
    const beschreibung = (geholt.bildBeschreibung ?? "").trim();
    if (beschreibung === "") throw new Vorabfehler("Die Bildbeschreibung fehlt");
    if (Array.from(beschreibung).length > grenzen.beschreibung) {
        throw new Vorabfehler(`Die Bildbeschreibung ist länger, als ${dienstName(kanal, false)} erlaubt`);
    }
    return { urteil, beschreibung };
}

/** Format und Größe einer Datei gegen die Grenzen des Dienstes. */
function pruefeFormat(mime: string, bytes: number, grenzen: MastodonGrenzen, kanal: KanalMitZugang): void {
    if (!grenzen.bildTypen.includes(mime))
        throw new Vorabfehler(`${dienstName(kanal, true)} nimmt dieses Bildformat nicht an`);
    if (bytes > grenzen.bildBytes)
        throw new Vorabfehler(`Das Bild ist größer, als ${dienstName(kanal, false)} erlaubt`);
}

/** Die öffentliche Datei. Fehlt sie bei einem Bild der Kategorie „Social Media Posts“, rechnet der Abgleich sie gleich; bei jedem anderen entsteht sie nicht von selbst. */
function oeffentlicheDatei(geholt: Geholt, urteil: SocialBildUrteil): NonNullable<Geholt["bildDatei"]> {
    if (geholt.bildDatei !== null) return geholt.bildDatei;
    if (urteil.typ === "social_post") throw new BildWartet("Zum Bild gibt es keine veröffentlichte Fassung");
    throw new Vorabfehler("Zum Bild gibt es keine veröffentlichte Fassung");
}

/**
 * Das Bild für einen Dienst, der die Bytes bekommt. Ein Bild der Kategorie „Social Media Posts“ hat seine Fassung schon; jedes andere wird für den Beitrag gerechnet (`beitrag-bild.ts`), damit es weder zugeschnitten
 * noch klein hinausgeht und auch dann, wenn es nirgends hängt. Lässt es sich nicht rechnen, geht die öffentliche Datei.
 */
async function bildFuerDienst(
    db: Queryable,
    geholt: Geholt,
    grenzen: MastodonGrenzen,
    kanal: KanalMitZugang,
    deps: SocialSendenAbhaengigkeiten,
    umgebung: NodeJS.ProcessEnv,
): Promise<{ bytes: Uint8Array; mime: string; beschreibung: string }> {
    const { urteil, beschreibung } = await pruefeFreigabe(db, geholt, grenzen, kanal);
    const ablage = deps.bilder ?? medienAblage(umgebung);
    if (urteil.typ !== "social_post" && ablage !== undefined) {
        const gerechnet = await rechneBeitragsbild(db, geholt.bild ?? "", ablage);
        if (gerechnet !== null) {
            pruefeFormat(gerechnet.mime, gerechnet.bytes.byteLength, grenzen, kanal);
            return { ...gerechnet, beschreibung };
        }
    }
    const datei = oeffentlicheDatei(geholt, urteil);
    pruefeFormat(datei.mime, datei.bytes, grenzen, kanal);
    return { bytes: await leseBild(datei, grenzen, deps, umgebung), mime: datei.mime, beschreibung };
}

/** Liest die Bytes der Bilddatei aus der Medienablage. */
async function leseBild(
    datei: { schluessel: string },
    grenzen: MastodonGrenzen,
    deps: SocialSendenAbhaengigkeiten,
    umgebung: NodeJS.ProcessEnv,
): Promise<Uint8Array> {
    const bilder = deps.bilder ?? medienAblage(umgebung);
    if (bilder === undefined) throw new Vorabfehler("Die Medienablage ist in dieser Umgebung nicht eingerichtet");
    try {
        return await bilder.read(datei.schluessel, grenzen.bildBytes);
    } catch {
        throw new Vorabfehler("Die Bilddatei ist nicht lesbar");
    }
}

/** Wie ein Satz den Dienst nennt: Mastodon ist „die Instanz“ (eine von vielen), Facebook und Instagram heißen, wie sie heißen. `satzanfang` schreibt den ersten Buchstaben groß. */
function dienstName(kanal: KanalMitZugang, satzanfang: boolean): string {
    if (kanal !== "mastodon") return ZAEHLREGELN[kanal].name;
    return satzanfang ? "Die Instanz" : "die Instanz";
}

interface Sendeergebnis {
    ergebnis: Ergebnis;
    externId: string | null;
    adresse: string | null;
}

/** Sendet an Mastodon oder nimmt dort zurück (C12a, unverändert). */
async function ausfuehrenMastodon(
    db: Queryable,
    kontext: JobContext,
    deps: SocialSendenAbhaengigkeiten,
    umgebung: NodeJS.ProcessEnv,
    geholt: Geholt,
): Promise<Sendeergebnis> {
    const zugang: MastodonZugang | undefined = leseMastodonZugang(umgebung);
    if (zugang === undefined) throw new Vorabfehler("Der Kanal ist in dieser Umgebung nicht eingerichtet");
    if (geholt.aufgabe === "zuruecknehmen") {
        if (geholt.externId === null) throw new Vorabfehler("Die Kennung des Beitrags bei Mastodon fehlt");
        await kontext.beginPhase("zuruecknehmen", 0.4);
        await nimmZurueck(zugang, geholt.externId, deps);
        return { ergebnis: "zurueckgenommen", externId: null, adresse: null };
    }
    const grenzen = pruefeVorab(geholt, grenzenAusTafel(geholt.grenzen, "mastodon"));
    const text = textFuer("mastodon", geholt, grenzen);
    let bildId: string | undefined;
    if (geholt.bild !== null) {
        const bild = await bildFuerDienst(db, geholt, grenzen, "mastodon", deps, umgebung);
        await kontext.beginPhase("bild", 0.3);
        bildId = await ladeBildHoch(zugang, bild, deps);
    }
    await kontext.beginPhase("senden", 0.6);
    const gesendet = await sende(zugang, { text, bildId, idempotenz: geholt.idempotenz }, deps);
    return { ergebnis: "gesendet", externId: gesendet.id, adresse: gesendet.url };
}

/** Sendet an Facebook oder nimmt dort zurück (C12b). */
async function ausfuehrenFacebook(
    db: Queryable,
    kontext: JobContext,
    deps: SocialSendenAbhaengigkeiten,
    umgebung: NodeJS.ProcessEnv,
    geholt: Geholt,
): Promise<Sendeergebnis> {
    const zugang: MetaZugang | undefined = leseMetaZugang("facebook", umgebung);
    if (zugang === undefined) throw new Vorabfehler("Der Kanal ist in dieser Umgebung nicht eingerichtet");
    if (geholt.aufgabe === "zuruecknehmen") {
        if (geholt.externId === null) throw new Vorabfehler("Die Kennung des Beitrags bei Facebook fehlt");
        await kontext.beginPhase("zuruecknehmen", 0.4);
        await facebook.nimmZurueck(zugang, geholt.externId, deps);
        return { ergebnis: "zurueckgenommen", externId: null, adresse: null };
    }
    const grenzen = pruefeVorab(geholt, grenzenAusTafel(geholt.grenzen, "facebook"));
    const text = textFuer("facebook", geholt, grenzen);
    // Meta kennt keinen Idempotenz-Kopf: Hat die Sendung schon eine Kennung bei Facebook und den Beitrag gibt es dort noch, ist er gesendet - nichts wird ein zweites Mal gesendet.
    if (geholt.externId !== null && (await facebook.gibtEs(zugang, geholt.externId, deps))) {
        return { ergebnis: "gesendet", externId: geholt.externId, adresse: facebook.facebookAdresse(geholt.externId) };
    }
    let bild: facebook.FacebookBeitrag["bild"];
    if (geholt.bild !== null) {
        bild = await bildFuerDienst(db, geholt, grenzen, "facebook", deps, umgebung);
        await kontext.beginPhase("bild", 0.3);
    }
    await kontext.beginPhase("senden", 0.6);
    const gesendet = await facebook.sende(zugang, { text, bild }, deps);
    return { ergebnis: "gesendet", externId: gesendet.id, adresse: gesendet.url };
}

/** Sendet an Discord oder nimmt dort zurück: als Einbettung mit Titelzeile, wie die Vorschau des Hubs. */
async function ausfuehrenDiscord(
    db: Queryable,
    kontext: JobContext,
    deps: SocialSendenAbhaengigkeiten,
    umgebung: NodeJS.ProcessEnv,
    geholt: Geholt,
): Promise<Sendeergebnis> {
    const zugang: DiscordZugang | undefined = leseDiscordZugang(umgebung);
    if (zugang === undefined) throw new Vorabfehler("Der Kanal ist in dieser Umgebung nicht eingerichtet");
    if (geholt.aufgabe === "zuruecknehmen") {
        if (geholt.externId === null) throw new Vorabfehler("Die Kennung der Nachricht bei Discord fehlt");
        await kontext.beginPhase("zuruecknehmen", 0.4);
        await discord.nimmZurueck(zugang, geholt.externId, deps);
        return { ergebnis: "zurueckgenommen", externId: null, adresse: null };
    }
    const grenzen = pruefeVorab(geholt, grenzenAusTafel(geholt.grenzen, "discord"));
    const text = textFuer("discord", geholt, grenzen);
    // Ein Webhook kennt keinen Idempotenz-Kopf: Hat die Sendung schon eine Kennung und die Nachricht gibt es noch, ist sie gesendet.
    if (geholt.externId !== null && (await discord.gibtEs(zugang, geholt.externId, deps))) {
        const { server } = await discord.leseWebhook(zugang, deps);
        return {
            ergebnis: "gesendet",
            externId: geholt.externId,
            adresse: discord.discordAdresse(server, zugang.kanal, geholt.externId),
        };
    }
    let bild: discord.DiscordBeitrag["bild"];
    if (geholt.bild !== null) {
        bild = await bildFuerDienst(db, geholt, grenzen, "discord", deps, umgebung);
        await kontext.beginPhase("bild", 0.3);
    }
    await kontext.beginPhase("senden", 0.6);
    const gesendet = await discord.sende(zugang, { titel: geholt.titel ?? undefined, text, bild }, deps);
    return { ergebnis: "gesendet", externId: gesendet.id, adresse: gesendet.url };
}

/** Sendet an Instagram (C12b); ein Zurücknehmen gibt es nicht. */
async function ausfuehrenInstagram(
    db: Queryable,
    kontext: JobContext,
    deps: SocialSendenAbhaengigkeiten,
    umgebung: NodeJS.ProcessEnv,
    beitrag: number,
    geholt: Geholt,
): Promise<Sendeergebnis> {
    const zugang: MetaZugang | undefined = leseMetaZugang("instagram", umgebung);
    if (zugang === undefined) throw new Vorabfehler("Der Kanal ist in dieser Umgebung nicht eingerichtet");
    if (geholt.aufgabe === "zuruecknehmen") {
        throw new Vorabfehler("Instagram erlaubt kein Löschen über die Schnittstelle; bitte in der App löschen");
    }
    const grenzen = pruefeVorab(geholt, grenzenAusTafel(geholt.grenzen, "instagram"));
    const text = textFuer("instagram", geholt, grenzen);
    if (geholt.bild === null) throw new Vorabfehler("Instagram sendet nur mit Bild");
    const container = instagram.containerAus(geholt.externId);
    // Meta kennt keinen Idempotenz-Kopf: Ist die Kennung KEIN Container, hat ein früherer Versuch den Beitrag schon veröffentlicht; gibt es ihn noch, wird nichts ein zweites Mal gesendet.
    if (
        geholt.externId !== null &&
        container === undefined &&
        (await instagram.gibtEs(zugang, geholt.externId, deps))
    ) {
        return {
            ergebnis: "gesendet",
            externId: geholt.externId,
            adresse: (await instagram.leseAdresse(zugang, geholt.externId, deps)) ?? instagram.INSTAGRAM_ALLGEMEIN,
        };
    }
    const { urteil, beschreibung } = await pruefeFreigabe(db, geholt, grenzen, "instagram");
    // Meta holt selbst ab: Hier geht nur die öffentliche Datei. Die Fassung für Instagram rechnet sich daraus.
    const datei = oeffentlicheDatei(geholt, urteil);
    pruefeFormat(datei.mime, datei.bytes, grenzen, "instagram");
    const bildUrl = instagram.bildAdresse(umgebung, datei.schluessel);
    if (bildUrl === undefined) {
        throw new Vorabfehler(
            "Das Bild hat keine öffentlich erreichbare Adresse: Diese Umgebung ist für Meta nicht erreichbar",
        );
    }
    // Instagram nimmt nur JPEG: die Fassung neben die WebP legen (idempotent) und Meta DEREN Adresse nennen.
    const ablage = deps.ablage ?? medienAblage(umgebung);
    if (ablage === undefined) throw new Vorabfehler("Die Medienablage ist in dieser Umgebung nicht eingerichtet");
    await kontext.beginPhase("bild", 0.3);
    try {
        await sichereInstagramBild(ablage, datei.schluessel, grenzen.bildBytes);
    } catch (fehler) {
        if (fehler instanceof InstagramBildFehler) throw new Vorabfehler(fehler.message);
        throw fehler;
    }
    await kontext.beginPhase("senden", 0.6);
    const gesendet = await instagram.sende(
        zugang,
        { text, bildUrl, beschreibung, container },
        deps,
        async (neuerContainer) => {
            // Die Kennung des Containers sofort merken: Scheitert Schritt 2, nimmt der nächste Versuch denselben Container.
            await eintragen(
                db,
                beitrag,
                "instagram",
                "zwischen",
                instagram.containerKennung(neuerContainer),
                null,
                null,
            );
        },
    );
    return { ergebnis: "gesendet", externId: gesendet.id, adresse: gesendet.url };
}

async function laufe(
    db: Queryable,
    kontext: JobContext,
    deps: SocialSendenAbhaengigkeiten,
): Promise<Record<string, unknown>> {
    const { beitrag, kanal } = leseSendenAuftrag(kontext.input);
    const jetzt = deps.jetzt ?? (() => new Date());
    const umgebung = deps.environment ?? process.env;
    await kontext.beginPhase("reservieren", 0);
    const geholt = await holen(db, beitrag, kanal);
    if (geholt === null) return { beitrag, kanal, ergebnis: "uebersprungen" };
    if (geholt.reserviert === true) {
        // Ein anderer Versuch hält die Sendung (oder starb nach dem Senden, vor dem Eintrag): Nach Ablauf der Reservierung nachsehen. Ist sie dann erledigt, endet der nächste Auftrag ohne Folgen.
        await reiheNachfolgerEin(db, kontext, beitrag, kanal, new Date(jetzt().getTime() + NACHSEHEN_MS));
        return { beitrag, kanal, ergebnis: "reserviert" };
    }

    let ergebnis: Ergebnis;
    let externId: string | null = null;
    let adresse: string | null = null;
    let grund: string | null = null;
    try {
        const getan =
            kanal === "mastodon"
                ? await ausfuehrenMastodon(db, kontext, deps, umgebung, geholt)
                : kanal === "facebook"
                  ? await ausfuehrenFacebook(db, kontext, deps, umgebung, geholt)
                  : kanal === "discord"
                    ? await ausfuehrenDiscord(db, kontext, deps, umgebung, geholt)
                    : await ausfuehrenInstagram(db, kontext, deps, umgebung, beitrag, geholt);
        ergebnis = getan.ergebnis;
        externId = getan.externId;
        adresse = getan.adresse;
    } catch (fehler) {
        if (fehler instanceof Vorabfehler) {
            ergebnis = "fehler";
            grund = fehler.message;
        } else if (fehler instanceof BildWartet) {
            ergebnis = "vorlaeufig";
            grund = fehler.message;
        } else if (
            fehler instanceof MastodonFehler ||
            fehler instanceof MetaFehler ||
            fehler instanceof discord.DiscordFehler
        ) {
            ergebnis = fehler.dauerhaft ? "fehler" : "vorlaeufig";
            grund = fehler.message;
        } else {
            throw fehler;
        }
    }
    await kontext.beginPhase("eintragen", 0.9);
    const stand = await eintragen(db, beitrag, kanal, ergebnis, externId, adresse, grund);
    if (stand === null) return { beitrag, kanal, ergebnis: "uebersprungen" };
    if (stand.aufgabe !== null) {
        // Ein vorübergehender Fehler mit Versuchen übrig: später noch einmal, mit Abstand.
        const abstand = SENDEN_ABSTAENDE_MS[Math.min(stand.versuche - 1, SENDEN_ABSTAENDE_MS.length - 1)] ?? 300_000;
        await reiheNachfolgerEin(db, kontext, beitrag, kanal, new Date(jetzt().getTime() + abstand));
        return { beitrag, kanal, zustand: stand.zustand, versuche: stand.versuche, naechsterVersuchInMs: abstand };
    }
    return { beitrag, kanal, zustand: stand.zustand, versuche: stand.versuche };
}

/** Der Handler im Job-Prozess. `deps` nur für Tests: die Testdatenbank, eine eigene Umgebung, eine gestellte Instanz. */
export async function runSocialSendenJob(
    kontext: JobContext,
    deps: SocialSendenAbhaengigkeiten = {},
): Promise<Record<string, unknown>> {
    try {
        if (deps.database !== undefined) return await laufe(deps.database, kontext, deps);
        return await withJobDatabase((database) => laufe(database, kontext, deps));
    } catch (fehler) {
        if (fehler instanceof JobFailure) throw fehler;
        const code = (fehler as { code?: unknown }).code;
        // Nur der SQLSTATE geht auf die Statusseite, nie ein Text. Eine verlorene Verbindung ist wiederholbar, ein fehlendes Recht nicht.
        throw new JobFailure(
            "social_senden_failed",
            `Social senden gescheitert, SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
            isDatabaseUnavailable(fehler),
        );
    }
}
