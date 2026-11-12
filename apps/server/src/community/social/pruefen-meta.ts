import { userInfo } from "node:os";
import { ZAEHLREGELN, type MastodonGrenzen, type ZaehlRegel } from "@avesmaps3d/shared";
import { recordEvent } from "../../auth/audit.ts";
import type { CliIo } from "../../auth/cli-commands.ts";
import { loadAuthConfig } from "../../auth/config.ts";
import { createDatabase } from "../../database.ts";
import { storageKey } from "../../media/storage.ts";
import * as facebook from "./kanaele/facebook.ts";
import * as instagram from "./kanaele/instagram.ts";
import { leseMetaZugang, leseOeffentlicheHerkunft, type MetaKanal, type MetaZugang } from "./kanaele/konfiguration.ts";
import { metaGrenzen, leseMetaKonto } from "./kanaele/meta.ts";
import { MetaFehler } from "./kanaele/meta-graph.ts";
import { speichereGrenzen } from "./kanaele/stand.ts";
import { InstagramBildFehler } from "./instagram-bild.ts";
import { medienAblage, sichereInstagramBild } from "./instagram-ableitung.ts";
import { PRUEFFAELLE, USAGE, baueProben, zaehle, type Probe, type Pruefall, type PruefenDeps } from "./pruefen.ts";

/**
 * Der Lauf von `social:pruefen` für Facebook und Instagram (WI-0268 C12b; Fachkonzept §15.7, Recherche `project-control/discovery/social-zeichengrenzen-2026-10-31.md` §4 und §5). Die Regeln des Werkzeugs sind die von
 * Mastodon (`pruefen.ts`); hier stehen die Unterschiede, die Meta mitbringt.
 *
 * - 🔴 **Ohne `--anwenden` kein Netz und kein Schreibzugriff:** Probelauf mit der eigenen Zählung. **Mit `--anwenden`** ist `--operator-said "<Zitat>"` Pflicht, und das konfigurierte Konto bekommt Testbeiträge: ein Testkonto, wenn es eines gibt, sonst das öffentliche Konto (so liefen die Prüfungen am 2026-11-01).
 * - **Facebook:** Die Proben gehen als unveröffentlichte Beiträge an die Seite (`published=false`: nur Administratoren sehen sie) und werden sofort gelöscht.
 * - 🔴 **Instagram kann Testbeiträge nicht löschen** (kein Löschen über die Schnittstelle): Jeder angenommene Beitrag steht danach öffentlich auf dem Konto, bis jemand ihn in der App löscht. Darum schickt das
 *   Werkzeug für Instagram nur mit `--testkonto-bestaetigt` (bestätigt, dass die Testbeiträge auf dem konfigurierten Konto öffentlich stehen bleiben dürfen, bis jemand sie löscht; der Name des Schalters ist älter) und braucht `--bild <https-Adresse>` (Instagram sendet nur mit Bild; Meta holt es von dort ab, es muss öffentlich
 *   erreichbar sein). Die Ausgabe nennt die Kennungen der Testbeiträge zum Löschen von Hand. Es sind absichtlich wenige Fälle (`PRUEFFAELLE_INSTAGRAM`), ohne Erwähnung und ohne Hashtag, damit keine fremde Person benannt wird.
 * - 🔴 **Instagram nimmt nur JPEG:** Ist `--bild` die WebP-Adresse eines Mediums DIESER Umgebung (`<PUBLIC_ORIGIN>/media/sha256/aa/bb/<hash>.webp`), legt der Lauf mit demselben Code wie der Versand (`instagram-ableitung.ts`) die
 *   JPEG-Fassung neben die WebP (`<hash>.ig.jpg`, braucht `MEDIA_ROOT` und Schreibrecht unter `published/`) und schickt Meta DEREN Adresse. Jede andere https-Adresse bleibt, wie sie ist: Wer sie nennt, verantwortet, dass sie ein
 *   JPEG liefert.
 * - **Gefährlich ist nur ein zu großzügiger Hub:** Nimmt Meta den Beitrag GENAU an der Grenze des Hubs nicht an, würde ein Beitrag öffentlich scheitern. Nimmt Meta einen mit einem Zeichen mehr an, zählt der Hub zu
 *   streng (Meta dokumentiert die Zählweise nicht, der Hub zählt vorsichtig; die Ausgabe sagt es, es verhindert die Freischaltung nicht). Anders als bei Mastodon, dessen Instanz ihre Zählung genau festlegt.
 * - **Ergebnis:** Block für die Tafel der Recherche (§7, mit Datum), `social_kanal_pruefung_eintragen` (bei Übereinstimmung `freigeschaltet_at`, JE KANAL) und das Protokoll `system.social_kanal_geprueft` (nur Zahlen).
 *   Die drei Prüfläufe (Mastodon, Facebook, Instagram) machen Claudio und Vali nacheinander; erst danach wird gesendet (Vali 2026-11-01: „stopp nein wir machen alles auf einmal live“).
 */

/** Die Fälle, die an Instagram gehen: die Einheit-Fälle ohne Erwähnung und Hashtag (beide würden dort ein Konto nennen oder ein Thema anlegen). Jeder angenommene Beitrag bleibt stehen. */
export const PRUEFFAELLE_INSTAGRAM: readonly string[] = ["umlaute", "familie", "crlf", "adresse"];

/** Die Fälle eines Kanals. */
export const faelleFuer = (kanal: MetaKanal): readonly Pruefall[] =>
    kanal === "instagram" ? PRUEFFAELLE.filter((fall) => PRUEFFAELLE_INSTAGRAM.includes(fall.id)) : PRUEFFAELLE;

export interface MetaPruefAufruf {
    readonly anwenden: boolean;
    readonly zitat: string | undefined;
    /** Die öffentliche Adresse des Testbilds (nur Instagram): ein JPEG, oder die WebP-Adresse eines Mediums dieser Umgebung (dann nimmt der Lauf dessen Instagram-Fassung). */
    readonly bild: string | undefined;
    readonly testkontoBestaetigt: boolean;
}

export interface MetaProbenErgebnis {
    readonly fall: Pruefall;
    /** Was der Hub zählt. */
    readonly n: number;
    /** Hat Meta den Beitrag an der Grenze des Hubs angenommen? */
    readonly grenzeAngenommen: boolean;
    /** Hat Meta den Beitrag mit einem Zeichen mehr abgelehnt? (Nein heißt: Der Hub zählt zu streng, das schadet nicht.) */
    readonly darueberAbgelehnt: boolean;
    /** Passt die Grenze: der Beitrag an der Grenze ging durch und liegt nach der Zählung genau auf ihr? */
    readonly ok: boolean;
}

const wort = (ja: boolean): string => (ja ? "ja" : "nein");

/** Die WebP-Adresse eines Mediums, wie sie `mediaPublicUrl` bildet. */
const MEDIA_WEBP = /^\/media\/sha256\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.webp$/u;

/**
 * Ist `bild` die WebP-Adresse eines Mediums dieser Umgebung? Dann der Hash. Dazu muss die Umgebung öffentlich erreichbar sein (`PUBLIC_ORIGIN`), die Herkunft gleich, die Form genau die von `mediaPublicUrl` und die
 * Adresse ohne Zugangsdaten, Abfrage und Anker. Alles andere (auch ein Bild von einem fremden Host) ist nicht das eigene Medium und bleibt unberührt.
 */
export function webpHashDieserUmgebung(bild: string, umgebung: NodeJS.ProcessEnv): string | undefined {
    const herkunft = leseOeffentlicheHerkunft(umgebung);
    if (herkunft === undefined) return undefined;
    let url: URL;
    try {
        url = new URL(bild);
    } catch {
        return undefined;
    }
    if (
        url.origin !== herkunft.origin ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== ""
    )
        return undefined;
    const teile = MEDIA_WEBP.exec(url.pathname);
    if (teile === null) return undefined;
    const [, erstes, zweites, sha256] = teile as unknown as [string, string, string, string];
    return erstes === sha256.slice(0, 2) && zweites === sha256.slice(2, 4) ? sha256 : undefined;
}

/**
 * Die Adresse, die an Instagram geht: bei einem eigenen Medium die der JPEG-Fassung (sie entsteht dabei neben der WebP, wenn sie fehlt), sonst die genannte. `fehler` ist ein Satz für die Ausgabe; dann geht nichts hinaus.
 */
export async function loeseTestbildAuf(
    bild: string,
    umgebung: NodeJS.ProcessEnv,
    deps: Pick<PruefenDeps, "ablage">,
): Promise<{ adresse: string; hinweis?: string } | { fehler: string }> {
    const sha256 = webpHashDieserUmgebung(bild, umgebung);
    if (sha256 === undefined) return { adresse: bild };
    const ablage = deps.ablage ?? medienAblage(umgebung);
    if (ablage === undefined) {
        return {
            fehler: "Das Testbild ist ein Medium dieser Umgebung, aber MEDIA_ROOT fehlt oder ist kein absoluter Pfad: Die JPEG-Fassung für Instagram lässt sich nicht anlegen.",
        };
    }
    const schluessel = storageKey("published", sha256, "webp");
    try {
        const fassung = await sichereInstagramBild(ablage, schluessel);
        const adresse = instagram.bildAdresse(umgebung, schluessel);
        if (adresse === undefined) return { fehler: "Die Adresse der JPEG-Fassung lässt sich nicht bilden." };
        return {
            adresse,
            hinweis: `Das Testbild ist ein Medium dieser Umgebung: Instagram bekommt dessen JPEG-Fassung (${fassung.erzeugt ? "eben angelegt" : "lag schon da"}): ${adresse}`,
        };
    } catch (fehler) {
        return {
            fehler: `Die JPEG-Fassung des Testbilds ließ sich nicht bereitstellen (${fehler instanceof InstagramBildFehler ? fehler.message : "Fehler"}).`,
        };
    }
}

/** Der Block zum Einfügen in die Tafel der Recherche (§7), mit Datum. */
export function metaTafelText(
    kanal: MetaKanal,
    ergebnisse: readonly MetaProbenErgebnis[],
    kopf: { datum: string; grenzen: MastodonGrenzen; freigeschaltet: boolean },
): string {
    const name = ZAEHLREGELN[kanal].name;
    return [
        `**Prüfung ${name} ${kopf.datum}** (Testkonto, Grenze des Hubs: ${String(kopf.grenzen.zeichen)} Zeichen in ${ZAEHLREGELN[kanal].einheit === "utf16" ? "UTF-16-Einheiten" : "Zeichen"}, Links zählen als Text; ${
            kopf.freigeschaltet ? "alle Fälle stimmen, Kanal freigeschaltet" : "NICHT freigeschaltet"
        })`,
        "",
        "| Fall | Hub zählt | an der Grenze angenommen | eins darüber abgelehnt | stimmt |",
        "|---|---|---|---|---|",
        ...ergebnisse.map(
            (e) =>
                `| ${e.fall.name} | ${String(e.n)} | ${wort(e.grenzeAngenommen)} | ${wort(e.darueberAbgelehnt)} | ${wort(e.ok)} |`,
        ),
    ].join("\n");
}

/** Hat Meta den Beitrag ABGELEHNT (im Gegensatz zu: Schlüssel, Rechte, Netz, Drosselung)? Dann zählt es als „nicht angenommen“, alles andere bricht den Lauf ab. */
function istAblehnung(fehler: unknown): boolean {
    if (!(fehler instanceof MetaFehler) || !fehler.dauerhaft) return false;
    if (fehler.status !== 400 && fehler.status !== 200) return false;
    const code = fehler.code;
    return !(code === 190 || code === 10 || (code !== undefined && code >= 200 && code <= 299));
}

const grundVon = (fehler: unknown): string =>
    fehler instanceof MetaFehler
        ? fehler.message
        : `Fehler (${String((fehler as { code?: unknown }).code ?? "unbekannt")})`;

/** Schickt eine Probe an den Kanal; gibt die Kennung bei Meta zurück. */
async function schicke(
    kanal: MetaKanal,
    zugang: MetaZugang,
    text: string,
    bildUrl: string | undefined,
    deps: PruefenDeps,
): Promise<string> {
    if (kanal === "facebook") return (await facebook.sende(zugang, { text, veroeffentlicht: false }, deps)).id;
    if (bildUrl === undefined) throw new Error("Instagram braucht ein Testbild");
    return (await instagram.sende(zugang, { text, bildUrl, beschreibung: "Testbild der Prüfung" }, deps)).id;
}

/** Löscht die Testbeiträge (nur Facebook); gibt die Kennungen zurück, die nicht zu löschen waren. */
async function loescheAlle(
    kanal: MetaKanal,
    zugang: MetaZugang,
    ids: readonly string[],
    deps: PruefenDeps,
): Promise<string[]> {
    if (kanal !== "facebook") return [...ids];
    const bleibt: string[] = [];
    for (const id of ids) {
        try {
            await facebook.nimmZurueck(zugang, id, deps);
        } catch {
            bleibt.push(id);
        }
    }
    return bleibt;
}

/**
 * Der Lauf für Facebook und Instagram. Rückgabe wie bei Mastodon: 0 in Ordnung, 1 Abweichung oder Fehler, 2 falscher Aufruf (auch: `--anwenden` ohne Zitat, Instagram ohne `--testkonto-bestaetigt` oder ohne `--bild`).
 */
export async function runMetaPruefen(
    kanal: MetaKanal,
    aufruf: MetaPruefAufruf,
    environment: NodeJS.ProcessEnv,
    io: CliIo,
    deps: PruefenDeps = {},
): Promise<number> {
    const name = ZAEHLREGELN[kanal].name;
    if (aufruf.bild !== undefined && kanal !== "instagram") {
        io.err(`--bild gilt nur für Instagram.\n${USAGE}`);
        return 2;
    }
    if (aufruf.bild !== undefined && !/^https:\/\/[^\s]{1,900}$/u.test(aufruf.bild)) {
        io.err(`--bild braucht eine https-Adresse.\n${USAGE}`);
        return 2;
    }
    // --- Trockenlauf: nur die eigene Zählung, ohne Netz --------------------------------------------------------------------------
    if (!aufruf.anwenden) {
        io.out("PROBELAUF - ohne --anwenden kein Netz und kein Schreibzugriff");
        if (aufruf.zitat !== undefined && aufruf.zitat !== "")
            io.out("Hinweis: --operator-said gilt nur mit --anwenden; dies ist ein Probelauf.");
        const regel = ZAEHLREGELN[kanal];
        io.out(
            `Zählregel des Hubs für ${name}  ${String(regel.grenze)} ${regel.einheit === "utf16" ? "UTF-16-Einheiten" : "Zeichen"}, Links zählen als Text`,
        );
        for (const probe of baueProben(regel, faelleFuer(kanal))) {
            io.out(
                `${probe.fall.name.padEnd(30)} Hub zählt ${String(zaehle(probe.fall.text, regel)).padStart(3)}  würde schicken: ${String(zaehle(probe.grenze, regel))} (angenommen erwartet) und ${String(zaehle(probe.darueber, regel))} (Ablehnung erwartet)`,
            );
        }
        if (kanal === "instagram") {
            io.out(
                "Instagram: Testbeiträge lassen sich über die Schnittstelle NICHT löschen. Mit --anwenden braucht das Werkzeug --testkonto-bestaetigt und --bild <https-Adresse>; die Testbeiträge sind danach von Hand zu löschen.",
            );
            io.out(
                "Instagram nimmt nur JPEG: Ist --bild die /media/sha256/…/<hash>.webp-Adresse eines Mediums dieser Umgebung, legt das Werkzeug mit --anwenden die JPEG-Fassung neben die WebP (<hash>.ig.jpg) und schickt deren Adresse; jede andere Adresse geht unverändert hinaus und muss ein JPEG liefern.",
            );
        } else {
            io.out("Facebook: Die Proben gehen unveröffentlicht an die Seite und werden gelöscht.");
        }
        return 0;
    }
    // 🔴 Vor allem anderen: Wer sendet und schreibt, braucht den Zuruf des Betreibers.
    if (aufruf.zitat === undefined || aufruf.zitat === "") {
        io.err(
            `--anwenden schickt Beiträge an das konfigurierte Konto und schreibt in die Datenbank. Es braucht den Zuruf des Betreibers für genau diese Umgebung: --operator-said "<Zitat>". Nichts geschickt, nichts geschrieben.\n${USAGE}`,
        );
        return 2;
    }
    if (kanal === "instagram") {
        if (!aufruf.testkontoBestaetigt) {
            io.err(
                `Instagram erlaubt kein Löschen über die Schnittstelle: Jeder Testbeitrag steht öffentlich auf dem Konto, bis jemand ihn in der App löscht. Das Werkzeug schickt nur, wenn mit --testkonto-bestaetigt feststeht, dass die Testbeiträge auf dem konfigurierten Konto öffentlich stehen bleiben dürfen. Nichts geschickt, nichts geschrieben.\n${USAGE}`,
            );
            return 2;
        }
        if (aufruf.bild === undefined) {
            io.err(
                `Instagram sendet nur mit Bild: --bild <https-Adresse eines öffentlich erreichbaren Testbilds> fehlt. Nichts geschickt.\n${USAGE}`,
            );
            return 2;
        }
    }
    const databaseUrl = environment["DATABASE_URL"];
    if (deps.database === undefined && databaseUrl === undefined) {
        io.err("DATABASE_URL fehlt.");
        return 2;
    }
    let umgebung;
    try {
        umgebung = loadAuthConfig(environment).environment;
    } catch (error) {
        io.err(`Die Umgebung ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
    if (umgebung === undefined) {
        io.err("AVESMAPS_ENV fehlt: Ohne benannte Umgebung gibt es kein Protokoll, also wird nichts geschickt.");
        return 2;
    }
    const zugang = leseMetaZugang(kanal, environment);
    if (zugang === undefined) {
        io.err(
            `Die Angaben für ${name} (COMMUNITY_SOCIAL_${kanal.toUpperCase()}_*) fehlen oder sind unbrauchbar: In dieser Umgebung gibt es den Kanal nicht. Nichts geschickt.`,
        );
        return 1;
    }
    // Instagram nimmt nur JPEG: ein eigenes Medium wird zu seiner JPEG-Fassung (vor allem anderen, damit bei einem Fehler nichts hinausgeht und nichts in der Datenbank steht).
    let bildAdresse = aufruf.bild;
    let bildHinweis: string | undefined;
    if (kanal === "instagram" && aufruf.bild !== undefined) {
        const aufgeloest = await loeseTestbildAuf(aufruf.bild, environment, deps);
        if ("fehler" in aufgeloest) {
            io.err(`${aufgeloest.fehler} Nichts geschickt.`);
            return 1;
        }
        bildAdresse = aufgeloest.adresse;
        bildHinweis = aufgeloest.hinweis;
    }
    const heute = (deps.heute ?? (() => new Date().toISOString().slice(0, 10)))();
    const marke = `cli:${deps.systemUser ?? userInfo().username}`;
    const database = deps.database ?? createDatabase(databaseUrl!, { max: 2 });
    const angenommen: string[] = [];
    const regel: ZaehlRegel = ZAEHLREGELN[kanal];
    try {
        io.out(`Freigabe (Betreiberzitat): „${aufruf.zitat}“`);
        io.out(
            kanal === "instagram"
                ? "Das konfigurierte Konto bekommt jetzt öffentliche Testbeiträge; sie sind danach von Hand in der App zu löschen."
                : "Das konfigurierte Konto bekommt jetzt unveröffentlichte Testbeiträge (nur für Administratoren sichtbar, sofort wieder gelöscht).",
        );

        // 1. Der Zugang: Der Schlüssel gilt und gehört zum Konto; die Grenzen des Hubs werden eingetragen.
        const grenzen = metaGrenzen(kanal);
        try {
            await leseMetaKonto(kanal, zugang, deps);
            await speichereGrenzen(database, kanal, grenzen);
        } catch (fehler) {
            io.err(`Der Zugang zu ${name} ist nicht lesbar: ${grundVon(fehler)}. Nichts geschickt.`);
            return 1;
        }
        io.out(`Grenze des Hubs                ${String(grenzen.zeichen)} Zeichen, Links zählen als Text`);
        if (bildHinweis !== undefined) io.out(bildHinweis);

        // 2. Die Proben: genau an der Grenze (muss durch), eins darüber (Ablehnung erwartet, sonst zählt der Hub zu streng).
        const ergebnisse: MetaProbenErgebnis[] = [];
        const meldungen: string[] = [];
        const proben: Probe[] = baueProben(regel, faelleFuer(kanal));
        for (const probe of proben) {
            let grenzeAngenommen = false;
            let darueberAbgelehnt = false;
            try {
                angenommen.push(await schicke(kanal, zugang, probe.grenze, bildAdresse, deps));
                grenzeAngenommen = true;
            } catch (fehler) {
                if (!istAblehnung(fehler)) throw fehler;
                meldungen.push(`${probe.fall.name}: ${grundVon(fehler)}`);
            }
            try {
                angenommen.push(await schicke(kanal, zugang, probe.darueber, bildAdresse, deps));
            } catch (fehler) {
                if (!istAblehnung(fehler)) throw fehler;
                darueberAbgelehnt = true;
            }
            ergebnisse.push({
                fall: probe.fall,
                n: zaehle(probe.fall.text, regel),
                grenzeAngenommen,
                darueberAbgelehnt,
                ok: grenzeAngenommen && zaehle(probe.grenze, regel) === regel.grenze,
            });
        }

        // 3. Aufräumen: Facebook löscht alles; bei Instagram bleiben die Testbeiträge stehen und werden genannt.
        const bleibt = await loescheAlle(kanal, zugang, angenommen, deps);
        angenommen.length = 0;
        if (bleibt.length > 0) {
            io.err(
                kanal === "instagram"
                    ? `Bitte in der Instagram-App von Hand löschen (Kennung bei Meta, ${String(bleibt.length)} Testbeiträge): ${bleibt.join(", ")}`
                    : `Bitte von Hand löschen (Kennung bei Meta): ${bleibt.join(", ")}`,
            );
        }

        const stimmt = ergebnisse.every((e) => e.ok);
        for (const e of ergebnisse) {
            const zu = !e.grenzeAngenommen
                ? "ZU GROSSZÜGIG (Meta nimmt den Beitrag an der Grenze nicht an)"
                : !e.darueberAbgelehnt
                  ? "zu streng (Meta nimmt eins mehr an, der Hub bleibt vorsichtig)"
                  : "ok";
            io.out(
                `${e.fall.name.padEnd(30)} Hub zählt ${String(e.n).padStart(3)}  an der Grenze ${wort(e.grenzeAngenommen).padEnd(4)} eins darüber abgelehnt ${wort(e.darueberAbgelehnt).padEnd(4)}  ${zu}`,
            );
        }
        for (const m of meldungen) io.out(`Meldung von Meta: ${m}`);
        // Ein Facebook-Testbeitrag, der nicht zu löschen war, sperrt (er bleibt auf der Seite); die Instagram-Beiträge sind absichtlich stehen geblieben und stehen in der Liste.
        const freigeschaltet = stimmt && (kanal === "instagram" || bleibt.length === 0);
        const kopf = { datum: heute, grenzen, freigeschaltet };
        io.out("");
        io.out("Text zum Einfügen in die Tafel der Recherche (§7):");
        io.out(metaTafelText(kanal, ergebnisse, kopf));
        io.out("");

        // 4. Eintragen: bei Übereinstimmung freigeschaltet, sonst gesperrt; dazu das Protokoll.
        try {
            await database`
                SELECT avesmaps_community.social_kanal_pruefung_eintragen(
                    ${kanal}, ${marke}, ${freigeschaltet},
                    ${database.json({ datum: heute, faelle: ergebnisse.length, uebereinstimmend: ergebnisse.filter((e) => e.ok).length })}::jsonb
                )
            `;
            await database.begin((tx) =>
                recordEvent(tx, {
                    environment: umgebung,
                    action: "system.social_kanal_geprueft",
                    actorKind: "cli",
                    actorLabel: marke,
                    targetRef: `kanal:${kanal}`,
                    details: {
                        kanal,
                        faelle: ergebnisse.length,
                        uebereinstimmend: ergebnisse.filter((e) => e.ok).length,
                        freigeschaltet,
                        zitat: true,
                    },
                }),
            );
        } catch (fehler) {
            io.err(
                `Das Ergebnis konnte nicht eingetragen werden (${String((fehler as { code?: unknown }).code ?? "Fehler")}). Der Kanal bleibt, wie er war.`,
            );
            return 1;
        }
        io.out(
            freigeschaltet
                ? `Der Kanal ${name} ist freigeschaltet (alle Fälle stimmen). Gesendet wird erst, wenn auch die anderen Kanäle geprüft sind (alle gehen gemeinsam live).`
                : `Der Kanal ${name} bleibt GESPERRT: Nicht alle Fälle stimmen oder ein Testbeitrag blieb stehen.`,
        );
        return freigeschaltet ? 0 : 1;
    } catch (fehler) {
        // Ein Abbruch mitten in den Proben: erst aufräumen (Facebook), dann berichten.
        const bleibt = await loescheAlle(kanal, zugang, angenommen, deps);
        if (bleibt.length > 0) io.err(`Bitte von Hand löschen (Kennung bei Meta): ${bleibt.join(", ")}`);
        io.err(`Abbruch: ${grundVon(fehler)}. Der Kanal bleibt, wie er war.`);
        return 1;
    } finally {
        if (deps.database === undefined) await database.end({ timeout: 5 });
    }
}
