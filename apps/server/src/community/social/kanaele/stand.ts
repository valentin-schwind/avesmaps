import {
    KANAL_MIT_ZUGANG,
    type KanalMitZugang,
    type MastodonGrenzen,
    type SocialKanalSperre,
    type SocialKanalStand,
} from "@avesmaps3d/shared";
import { isNotProvisioned, type Queryable } from "../../../database.ts";
import { DiscordFehler, discordGrenzen, leseWebhook } from "./discord.ts";
import {
    istMetaKanal,
    kanalEingerichtet,
    leseDiscordZugang,
    leseMastodonZugang,
    leseMetaZugang,
    type MetaKanal,
} from "./konfiguration.ts";
import { MastodonFehler, leseGrenzen, type MastodonDeps } from "./mastodon.ts";
import { metaGrenzen, leseMetaKonto } from "./meta.ts";
import { MetaFehler, type GraphDeps } from "./meta-graph.ts";

/**
 * Der Stand der fremden Kanäle in der Datenbank (WI-0268 C12a und C12b, Migrationen 0285 und 0286, Tafel `kanal_stand`) und was die Anwendung daraus macht: Welche Kanäle gibt es hier (Umgebung), sind sie
 * freigeschaltet (Zählregel gegen ein Testkonto geprüft, Recherche §5), steht der Notschalter an, welche Grenzen hat der Dienst gemeldet. Dazu die drei Handgriffe: Grenzen lesen und speichern, Notschalter setzen.
 * Bei Mastodon nennt die Instanz ihre Grenzen; bei Facebook, Instagram und Discord führt der Hub sie selbst (`meta.ts`, `discord.ts`) und der Lauf prüft stattdessen den Zugang.
 *
 * 🔴 Die App schreibt die Tafel NIE selbst, nur über die Funktionen `social_kanal_grenzen_setzen` und `social_kanal_notschalter` (`db/community-grants.psql`). Weder Adresse der Instanz noch Zugangsschlüssel kommen
 * hier an oder gehen hinaus; `eingerichtet` sagt allein, dass die Umgebung beide kennt.
 */

interface StandZeile {
    kanal: string;
    grenzen: unknown;
    grenzen_at: Date | null;
    notschalter: boolean;
    freigeschaltet_at: Date | null;
}

const ganz = (wert: unknown): number | undefined =>
    typeof wert === "number" && Number.isSafeInteger(wert) && wert >= 0 ? wert : undefined;

/**
 * Die gespeicherten Grenzen als Objekt; `null`, wenn sie fehlen oder nicht taugen (dann gilt der Kanal als ungelesen). Bei Mastodon muss die Länge einer Adresse mindestens 1 sein (die Instanz nennt sie), bei den Kanälen
 * von Meta ist sie 0 (Links zählen dort als Text).
 */
export function grenzenAusTafel(roh: unknown, kanal: KanalMitZugang = "mastodon"): MastodonGrenzen | null {
    if (typeof roh !== "object" || roh === null) return null;
    const j = roh as Record<string, unknown>;
    const zeichen = ganz(j["zeichen"]);
    const adresse = ganz(j["adresse"]);
    if (zeichen === undefined || zeichen < 1 || adresse === undefined || adresse < (kanal === "mastodon" ? 1 : 0))
        return null;
    return {
        zeichen,
        adresse,
        bilder: ganz(j["bilder"]) ?? 0,
        beschreibung: ganz(j["beschreibung"]) ?? 0,
        bildBytes: ganz(j["bildBytes"]) ?? 0,
        bildTypen: Array.isArray(j["bildTypen"])
            ? j["bildTypen"].filter((t): t is string => typeof t === "string")
            : [],
    };
}

/** Die Sperre eines Kanals in der Reihenfolge, in der eine Person sie beheben kann: erst einrichten, dann prüfen, dann den Notschalter lösen. */
export function sperreVon(s: {
    eingerichtet: boolean;
    freigeschaltet: boolean;
    notschalter: boolean;
}): SocialKanalSperre | null {
    if (!s.eingerichtet) return "nicht_eingerichtet";
    if (!s.freigeschaltet) return "nicht_freigeschaltet";
    if (s.notschalter) return "notschalter";
    return null;
}

/**
 * Der Stand jedes Kanals mit Zugang. Fehlt die Tafel noch (Migration 0285 nicht angewandt) oder das Recht, gilt jeder Kanal als nicht freigeschaltet: Der Hub sendet dann nicht an ihn, statt zu scheitern.
 */
export async function leseKanalStaende(
    db: Queryable,
    umgebung: NodeJS.ProcessEnv = process.env,
): Promise<SocialKanalStand[]> {
    let zeilen: StandZeile[] = [];
    try {
        zeilen = await db<StandZeile[]>`
            SELECT kanal, grenzen, grenzen_at, notschalter, freigeschaltet_at
              FROM avesmaps_community.kanal_stand WHERE kanal = ANY (${[...KANAL_MIT_ZUGANG]}::text[])
        `;
    } catch (fehler) {
        if (!isNotProvisioned(fehler)) throw fehler;
    }
    return KANAL_MIT_ZUGANG.map((kanal): SocialKanalStand => {
        const zeile = zeilen.find((z) => z.kanal === kanal);
        const eingerichtet = kanalEingerichtet(kanal, umgebung);
        const grenzen = grenzenAusTafel(zeile?.grenzen, kanal);
        // Ohne lesbare Grenzen ist die Zählregel nicht prüfbar: Auch eine gesetzte Freischaltung zählt dann nicht.
        const freigeschaltet = zeile?.freigeschaltet_at != null && grenzen !== null;
        const notschalter = zeile?.notschalter ?? false;
        const sperre = sperreVon({ eingerichtet, freigeschaltet, notschalter });
        return {
            kanal,
            eingerichtet,
            freigeschaltet,
            freigeschaltetAt: freigeschaltet ? (zeile?.freigeschaltet_at?.toISOString() ?? null) : null,
            notschalter,
            grenzen: grenzen === null ? null : { ...grenzen, bildTypen: [...grenzen.bildTypen] },
            grenzenAt: grenzen === null ? null : (zeile?.grenzen_at?.toISOString() ?? null),
            bereit: sperre === null,
            sperre,
        };
    });
}

/** Der Stand eines einzelnen Kanals. */
export async function leseKanalStand(
    db: Queryable,
    kanal: KanalMitZugang,
    umgebung: NodeJS.ProcessEnv = process.env,
): Promise<SocialKanalStand> {
    const stand = (await leseKanalStaende(db, umgebung)).find((s) => s.kanal === kanal);
    if (stand === undefined) throw new Error("unbekannter Kanal");
    return stand;
}

/** Trägt die gelesenen Grenzen ein (`social_kanal_grenzen_setzen`; die Datenbank prüft die harten Grenzen, KC422 bei Unsinn). */
export async function speichereGrenzen(db: Queryable, kanal: KanalMitZugang, grenzen: MastodonGrenzen): Promise<void> {
    const json = {
        zeichen: grenzen.zeichen,
        adresse: grenzen.adresse,
        bilder: grenzen.bilder,
        beschreibung: grenzen.beschreibung,
        bildBytes: grenzen.bildBytes,
        bildTypen: [...grenzen.bildTypen],
    };
    await db`SELECT avesmaps_community.social_kanal_grenzen_setzen(${kanal}, ${db.json(json)}::jsonb)`;
}

/** Setzt den Notschalter. `true`, wenn sich etwas änderte (nur dann schreibt die Route das Protokoll). */
export async function setzeNotschalter(db: Queryable, kanal: KanalMitZugang, an: boolean): Promise<boolean> {
    const [zeile] = await db<{ ergebnis: { geaendert: boolean } }[]>`
        SELECT avesmaps_community.social_kanal_notschalter(${kanal}, ${an}) AS ergebnis
    `;
    return zeile?.ergebnis.geaendert === true;
}

/** Wie ein Lauf der Grenzen ausging: gelesen, aus (die Umgebung kennt den Kanal nicht) oder der kurze Satz des Fehlers (ohne Schlüssel, ohne Adresse). */
export type GrenzenErgebnis =
    | { readonly art: "gelesen"; readonly grenzen: MastodonGrenzen }
    | { readonly art: "aus" }
    /** `dauerhaft`: Der Dienst lehnt den Zugang ab (Schlüssel, Rechte); sonst hat er nicht oder unbrauchbar geantwortet. `status`: seine HTTP-Antwort, falls es eine gab. */
    | {
          readonly art: "fehler";
          readonly satz: string;
          readonly dauerhaft: boolean;
          readonly status?: number | undefined;
      };

/**
 * Liest die Grenzen von der Instanz und trägt sie ein, wenn sich etwas geändert hat oder noch nichts steht (die Route „Grenzen neu lesen“, die tägliche Pflege und das Werkzeug rufen es). Eine geänderte
 * Instanzgrenze gilt ab dem nächsten Lesen (Umsetzungsplan C12). Fehler der Instanz kommen als `fehler` mit festem Satz zurück; ein Fehler der Datenbank wirft.
 */
export async function liesUndSpeichereGrenzen(
    db: Queryable,
    umgebung: NodeJS.ProcessEnv = process.env,
    deps: MastodonDeps = {},
): Promise<GrenzenErgebnis> {
    const zugang = leseMastodonZugang(umgebung);
    if (zugang === undefined) return { art: "aus" };
    let grenzen: MastodonGrenzen;
    try {
        grenzen = await leseGrenzen(zugang, deps);
    } catch (fehler) {
        if (fehler instanceof MastodonFehler) {
            return { art: "fehler", satz: fehler.message, dauerhaft: fehler.dauerhaft, status: fehler.status };
        }
        throw fehler;
    }
    await speichereGrenzen(db, "mastodon", grenzen);
    return { art: "gelesen", grenzen };
}

/**
 * Der Zugang eines Meta-Kanals: Der Hub führt die Grenzen selbst (`metaGrenzen`); gelesen wird nur, ob der Schlüssel noch gilt und zum Konto gehört (ein lesender Aufruf). Gelingt es, trägt der Lauf die Grenzen mit dem
 * Tag ein (`grenzen_at` ist dann der Tag der letzten gelungenen Prüfung des Zugangs); scheitert es, bleibt der Stand, wie er war, und der Satz des Fehlers (ohne Schlüssel) kommt zurück - so sieht der tägliche Lauf
 * einen abgelaufenen Schlüssel, bevor ein Beitrag daran scheitert.
 */
export async function pruefeUndSpeichereMetaZugang(
    db: Queryable,
    kanal: MetaKanal,
    umgebung: NodeJS.ProcessEnv = process.env,
    deps: GraphDeps = {},
): Promise<GrenzenErgebnis> {
    const zugang = leseMetaZugang(kanal, umgebung);
    if (zugang === undefined) return { art: "aus" };
    try {
        await leseMetaKonto(kanal, zugang, deps);
    } catch (fehler) {
        if (fehler instanceof MetaFehler) {
            return { art: "fehler", satz: fehler.message, dauerhaft: fehler.dauerhaft, status: fehler.status };
        }
        throw fehler;
    }
    const grenzen = metaGrenzen(kanal);
    await speichereGrenzen(db, kanal, grenzen);
    return { art: "gelesen", grenzen };
}

/**
 * Der Zugang zu Discord, wie bei Meta: Der Hub führt die Grenzen selbst (`discordGrenzen`); gelesen wird nur, ob der Webhook noch gilt und zum eingestellten Kanal gehört (nichts wird gesendet). Gelingt es, trägt der Lauf die
 * Grenzen mit dem Tag ein; scheitert es, bleibt der Stand, wie er war, und der Satz des Fehlers (ohne Schlüssel) kommt zurück.
 */
export async function pruefeUndSpeichereDiscordZugang(
    db: Queryable,
    umgebung: NodeJS.ProcessEnv = process.env,
    deps: MastodonDeps & GraphDeps = {},
): Promise<GrenzenErgebnis> {
    const zugang = leseDiscordZugang(umgebung);
    if (zugang === undefined) return { art: "aus" };
    try {
        await leseWebhook(zugang, deps);
    } catch (fehler) {
        if (fehler instanceof DiscordFehler) {
            return { art: "fehler", satz: fehler.message, dauerhaft: fehler.dauerhaft, status: fehler.status };
        }
        throw fehler;
    }
    const grenzen = discordGrenzen();
    await speichereGrenzen(db, "discord", grenzen);
    return { art: "gelesen", grenzen };
}

/** Liest die Grenzen (Mastodon) beziehungsweise prüft den Zugang (Facebook, Instagram, Discord) EINES Kanals und trägt das Ergebnis ein. Die Route „Grenzen neu lesen“ ruft es. */
export function liesUndSpeichereKanal(
    db: Queryable,
    kanal: KanalMitZugang,
    umgebung: NodeJS.ProcessEnv = process.env,
    deps: MastodonDeps & GraphDeps = {},
): Promise<GrenzenErgebnis> {
    if (kanal === "discord") return pruefeUndSpeichereDiscordZugang(db, umgebung, deps);
    return istMetaKanal(kanal)
        ? pruefeUndSpeichereMetaZugang(db, kanal, umgebung, deps)
        : liesUndSpeichereGrenzen(db, umgebung, deps);
}

/**
 * Die tägliche Pflege aller Kanäle mit Zugang (der Lauf der Aufbewahrung der Community): Jeder Kanal für sich, ein Ausfall des einen hält die anderen nicht an. Das Ergebnis sind nur Wörter je Kanal
 * (`gelesen`, `aus`, `fehler`), nie ein Satz mit Adresse oder Schlüssel; ein Fehler der Datenbank wirft.
 */
export async function pflegeKanaele(
    db: Queryable,
    umgebung: NodeJS.ProcessEnv = process.env,
    deps: MastodonDeps & GraphDeps = {},
): Promise<Record<string, string>> {
    const ergebnis: Record<string, string> = {};
    for (const kanal of KANAL_MIT_ZUGANG) {
        const stand = await liesUndSpeichereKanal(db, kanal, umgebung, deps);
        ergebnis[`social${kanal.charAt(0).toUpperCase()}${kanal.slice(1)}`] = stand.art;
    }
    return ergebnis;
}
