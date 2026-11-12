import { capabilitiesFor, isRole, type CommunityDiscordStand, type CommunityDiscordZeile } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { abschliessen } from "../kanal/db.ts";
import { NACHRICHT_MAX } from "./befehle.ts";
import type { BrueckeGrund, CommunityBruecke, OffenErgebnis } from "./community-bruecke.ts";
import { SAETZE, entschaerft } from "./interaktion.ts";
import { LINKARTIG, kuerze, oeffentlichGekuerzt, sichererSatz, satzTauglich } from "./muster.ts";

/**
 * `/offen` und `/erledigt` (WI-0255 Paket 2; Handover `project-control/handovers/2026-10-30-discord-offen-erledigt-an-claudia.md`). Legacy hatte beide
 * (`list_open_cases`, `close_case`); bei uns lesen und schließen sie Vorgänge im Betreiber-Kanal, keine zweite Fallverwaltung.
 *
 * - **`/offen`:** die offenen Meldungen aus Discord in dieser Umgebung, nur gesichtete, mit Nummer, Art und Kurztitel; kein Meldetext, kein Melder.
 *   Dazu die eigenen, die noch nicht gesichtet sind, nur mit Nummer und Art: Die Antwort sieht nur, wer fragt, und ohne die Nummer gäbe es kein
 *   `/erledigt` für eine Meldung, die sich vor dem Sichten erledigt hat.
 * - **`/erledigt nummer:<n>`** (Vali 2026-10-30: „a: melder und betreiber, deren discord konto mit avesmaps verknüpft ist“; Community-Fachkonzept §8.1):
 *   Ein Betreiber, dessen Discord-Konto an seinem Avesmaps-Konto hängt (`avesmaps_auth.discord_login`) und der hier den Kanal führen darf
 *   (`use_operator_channel`), schließt jede Meldung aus Discord als Person (`kanal_abschliessen`, `erledigt`). Sonst darf nur der Melder seine eigene
 *   schließen (`kanal_discord_zurueckziehen`, Migration 0260: Die Datenbank vergleicht `melder_kennung`). 🔴 Fremd und unbekannt bekommen denselben
 *   Satz: Er verrät nicht, ob es den Vorgang gibt.
 * - **Website-Meldungen** (WI-0268 C8, Fachkonzept §8.3a; Vali 2026-10-31 „Ja, über Production (A)“): `/offen` hängt unter die Discord-Fälle die eigenen Meldungen
 *   von der Website (`COM-…`, Stand, Kurztitel), die Production über die Brücke (`community-bruecke.ts`) liefert; `/erledigt meldung:COM-…` zieht eine eigene
 *   zurück. Fehlt die Brücke, bleibt alles wie vor C8; fällt sie aus, sagt `/offen` es in einem Satz. Betreiber schließen Website-Meldungen nicht aus Discord
 *   (nur in der Redaktion).
 * - 🔴 Die Discord-Kennung geht nur in die Abfragen (Datenbank, Brücke), nie in eine Antwort.
 */

/** So viele Zeilen nennt `/offen` höchstens; was darüber liegt, zählt „… und N weitere“. */
export const OFFEN_MAX = 15;

/** So viele Zeichen darf der Teil mit den Discord-Fällen höchstens haben; der Rest der 2000 gehört den Meldungen von der Website. */
const DISCORD_TEIL_MAX = 1400;
/** So lang wird die Beschreibung unter einem Eintrag höchstens (zwei vollständige Sätze). */
const BESCHREIBUNG_MAX = 200;

const ABKUERZUNG = /(?:^|[\s(])(?:z\.\s?b|d\.\s?h|u\.\s?a|o\.\s?ä|bzw|ca|evtl|ggf|etc|usw|nr|s|vgl|[zduo])\.$/iu;
/** Der angehängte Ort (`meldungstext` in `interaktion.ts`: Inhalt, Leerzeile, `Wo: …`) gehört nicht in die Beschreibung. */
const ORT_ANHANG = /\n\s*\n\s*Wo:[\s\S]*$/u;

/** Zerlegt in Sätze; hinter gängigen deutschen Abkürzungen (`z. B.`, `ggf.`, `Nr.`) endet kein Satz. */
function saetzeVon(text: string): { saetze: string[]; offen: string } {
    const saetze: string[] = [];
    let aktuell = "";
    for (const stueck of text.split(/(?<=[.!?])\s+/u)) {
        aktuell = aktuell === "" ? stueck : `${aktuell} ${stueck}`;
        if (/[.!?]$/u.test(aktuell) && !ABKUERZUNG.test(aktuell)) {
            saetze.push(aktuell);
            aktuell = "";
        }
    }
    return { saetze, offen: aktuell };
}

/**
 * Die Beschreibung unter einem Eintrag von `/offen`: bis zu zwei vollständige Sätze aus dem Text der Meldung, am Satzende geschnitten. Gleiche öffentliche
 * Bereinigung wie beim Titel (kein Verweis, keine Kennung, keine Erwähnung); ein Satz, der daran scheitert, fällt weg. Hat der Text kein Satzende oder ist
 * schon der erste Satz zu lang, wird sinnvoll mit „…“ gekürzt. Leer, wo nichts Brauchbares bleibt oder der Text nur den Titel wiederholt.
 */
export function beschreibung(text: string, titel: string): string {
    const rein = sichererSatz(text.replace(ORT_ANHANG, ""));
    if (rein === "") return "";
    const { saetze: ganze, offen } = saetzeVon(rein);
    const tauglich = (satz: string): boolean => satzTauglich(satz) && !LINKARTIG.test(satz);
    // Ohne ganzen Satz: der Rest, ohne eine hängende Abkürzung am Ende, mit „…“ gekürzt.
    const haengt = ABKUERZUNG.test(offen);
    const rest = haengt ? offen.replace(ABKUERZUNG, "").replace(/[\s,;:(-]+$/u, "") : offen;
    const saetze = (ganze.length > 0 ? ganze : [rest === "" || !haengt ? rest : `${rest}…`]).filter(
        (satz) => satz !== "" && tauglich(satz),
    );
    const erster = saetze[0];
    if (erster === undefined) return "";
    let ergebnis = erster.length > BESCHREIBUNG_MAX ? kuerze(erster, BESCHREIBUNG_MAX) : erster;
    const zweiter = saetze[1];
    if (zweiter !== undefined && !ergebnis.endsWith("…") && `${ergebnis} ${zweiter}`.length <= BESCHREIBUNG_MAX)
        ergebnis = `${ergebnis} ${zweiter}`;
    return ergebnis === sichererSatz(titel) ? "" : ergebnis;
}

const ART: Record<string, string> = { bug: "Fehler", idee: "Idee", nutzerfrage: "Frage" };
const GESCHLOSSEN = ["abgenommen", "abgelehnt", "beantwortet"] as const;

interface OffenZeile {
    id: string;
    kategorie: string;
    status: string;
    titel: string | null;
    kurztitel: string | null;
    nachricht: string | null;
}

/** Die Antwort auf `/offen`: Kopf, eine Zeile je Meldung, am Ende der Hinweis auf `/erledigt`; ohne Meldung ein Satz. */
export async function offenSatz(db: Queryable, environment: string, kennung: string | null): Promise<string> {
    const zeilen = await db<OffenZeile[]>`
        SELECT v.id::text, v.kategorie, v.status, v.titel, v.kurztitel, v.nachricht
          FROM avesmaps_kanal.vorgang v
         WHERE v.quelle = 'discord' AND v.environment = ${environment} AND v.abgelaufen_at IS NULL
           AND v.status <> ALL(${[...GESCHLOSSEN]}::text[])
           AND (v.status <> 'zu_sichten' OR v.melder_kennung = ${kennung})
         ORDER BY v.gemeldet_at, v.id
         LIMIT ${OFFEN_MAX + 1}
    `;
    if (zeilen.length === 0) return SAETZE.offenLeer;
    const [{ anzahl } = { anzahl: zeilen.length }] =
        zeilen.length > OFFEN_MAX
            ? await db<{ anzahl: number }[]>`
                  SELECT count(*)::int AS anzahl FROM avesmaps_kanal.vorgang v
                   WHERE v.quelle = 'discord' AND v.environment = ${environment} AND v.abgelaufen_at IS NULL
                     AND v.status <> ALL(${[...GESCHLOSSEN]}::text[])
                     AND (v.status <> 'zu_sichten' OR v.melder_kennung = ${kennung})
              `
            : [];
    const eintraege = zeilen.slice(0, OFFEN_MAX).map((zeile) => {
        const art = ART[zeile.kategorie] ?? "Meldung";
        const ops = `(\`${String(Number(zeile.id))}\`)`;
        if (zeile.status === "zu_sichten") return `${art} · eigene, noch nicht gesichtet ${ops}`;
        const titel = oeffentlichGekuerzt(zeile.kurztitel ?? zeile.titel ?? "", 70);
        const kopf = `${art}${titel === "" ? "" : ` · ${titel}`} ${ops}`;
        const text = beschreibung(zeile.nachricht ?? "", titel);
        return text === "" ? kopf : `${kopf}\n> ${text}`;
    });
    const baue = (n: number): string => {
        const weitere = Math.max(anzahl - n, 0);
        return [
            "**Offene Meldungen aus Discord**",
            ...eintraege.slice(0, n),
            ...(weitere > 0 ? [`… und ${String(weitere)} weitere`] : []),
            "`/erledigt nummer:123` schließt eine eigene Meldung.",
        ].join("\n");
    };
    let gezeigt = eintraege.length;
    while (gezeigt > 1 && baue(gezeigt).length > DISCORD_TEIL_MAX) gezeigt -= 1;
    return baue(gezeigt);
}

export type ErledigtUrteil = "erledigt" | "geschlossen" | "fremd";

/** Die Person eines Betreibers zu dieser Discord-Kennung, wenn sie hier den Kanal führen darf; sonst `undefined`. */
async function betreiberZu(db: Queryable, environment: string, kennung: string): Promise<string | undefined> {
    const [zeile] = await db<{ id: string; role: string; grants: string[] }[]>`
        SELECT p.id::text AS id, a.role,
               coalesce(array_agg(g.capability ORDER BY g.capability) FILTER (WHERE g.capability IS NOT NULL), '{}') AS grants
          FROM avesmaps_auth.discord_login d
          JOIN avesmaps_auth.person p ON p.id = d.person_id AND p.status = 'active'
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = ${environment} AND a.status = 'active'
          LEFT JOIN avesmaps_auth.capability_grant g
            ON g.person_id = p.id AND g.environment = ${environment} AND g.revoked_at IS NULL
         WHERE d.discord_user_id = ${kennung}
         GROUP BY p.id, a.role
    `;
    if (zeile === undefined || !isRole(zeile.role)) return undefined;
    return capabilitiesFor(zeile.role, zeile.grants).has("use_operator_channel") ? zeile.id : undefined;
}

/** `/erledigt`: der Betreiber jede Meldung aus Discord, sonst der Melder seine eigene. Wirft nur bei einer Störung der Datenbank. */
export async function erledige(
    db: Queryable,
    environment: string,
    nummer: number,
    kennung: string | null,
    operation: string,
): Promise<ErledigtUrteil> {
    if (kennung === null) return "fremd";
    const person = await betreiberZu(db, environment, kennung);
    if (person !== undefined) {
        const [vorgang] = await db<{ revision: number; status: string }[]>`
            SELECT revision, status FROM avesmaps_kanal.vorgang
             WHERE id = ${nummer} AND environment = ${environment} AND quelle = 'discord' AND abgelaufen_at IS NULL
        `;
        if (vorgang === undefined) return "fremd";
        if ((GESCHLOSSEN as readonly string[]).includes(vorgang.status)) return "geschlossen";
        await abschliessen(
            db,
            nummer,
            person,
            vorgang.revision,
            "erledigt",
            "In Discord geschlossen (/erledigt).",
            operation,
        );
        return "erledigt";
    }
    const [zeile] = await db<{ r: string }[]>`
        SELECT avesmaps_kanal.kanal_discord_zurueckziehen(${operation}::uuid, ${environment}, ${nummer}::bigint, ${kennung}) AS r
    `;
    return zeile?.r === "erledigt" || zeile?.r === "geschlossen" ? zeile.r : "fremd";
}

/** So viele Zeilen von der Website nennt `/offen` höchstens; der Rest zählt „… und N weitere“. Dazu gilt die Grenze einer Discord-Nachricht. */
export const WEBSITE_MAX = 8;

/** Der Stand in Alltagssprache, wie der Melder ihn auf der Statusseite liest. */
const STAND: Record<CommunityDiscordStand, string> = {
    eingegangen: "Eingegangen",
    in_bearbeitung: "In Bearbeitung",
    rueckfrage: "Rückfrage der Redaktion",
    abgeschlossen: "Abgeschlossen",
};

/**
 * Wie lang die Antwort der Redaktion unter einer Meldung höchstens steht (WI-0297; Vali wählte Option B, die letzte Antwort in `/offen`). Reicht der Platz der Nachricht nicht,
 * wird zuerst die Antwort kürzer, bis `ANTWORT_MIN`; erst dann fallen Zeilen weg.
 */
export const ANTWORT_IN_OFFEN_MAX = 900;
const ANTWORT_MIN = 160;

/** Die Antwort als Zitat unter der Zeile: jede Zeile mit „> “, Erwähnungen entschärft, gekürzt; ohne Antwort nichts. */
function antwortZitat(zeile: CommunityDiscordZeile, max: number): string[] {
    if (zeile.antwort === undefined) return [];
    const text = kuerze(entschaerft(zeile.antwort.text).trim(), max);
    if (text === "") return [];
    const [erste = "", ...rest] = text.split("\n");
    return [`> **${SAETZE.antwortKopf}** ${erste}`, ...rest.map((z) => `> ${z}`)];
}

/**
 * Der Satz von `/offen` mit den Meldungen von der Website darunter. Liefert die Brücke nichts oder ist sie aus, bleibt der Satz, wie er war; fiel sie aus, steht
 * ein Satz dazu. Der Kurztitel kommt von Production, stammt aber von einem Menschen (der Bezugsname): bereinigt, gekürzt und ohne Verweis wie jeder Titel aus dem
 * Kanal. Zeilen, die nicht in die 2000 Zeichen einer Nachricht passen, fallen weg und zählen als „weitere“.
 */
export function offenMitWebsite(discordSatz: string, website: OffenErgebnis): string {
    if (website.art === "aus") return discordSatz;
    if (website.art === "ausfall") return `${discordSatz}\n\n${SAETZE.websiteNichtErreichbar}`;
    if (website.zeilen.length === 0) return discordSatz;
    const zeilen = (antwortMax: number): string[] =>
        website.zeilen.map((zeile) => {
            const titel = oeffentlichGekuerzt(entschaerft(zeile.kurztitel), 70);
            const kopf = `${STAND[zeile.stand]}${titel === "" ? "" : ` · ${titel}`} (\`${zeile.nummer}\`)`;
            return [kopf, ...antwortZitat(zeile, antwortMax)].join("\n");
        });
    const baue = (anzahl: number, antwortMax: number): string => {
        const alle = zeilen(antwortMax);
        return [
            discordSatz,
            "",
            SAETZE.websiteKopf,
            ...alle.slice(0, anzahl),
            ...(alle.length > anzahl ? [`… und ${String(alle.length - anzahl)} weitere`] : []),
            SAETZE.websiteHinweis,
        ].join("\n");
    };
    const anzahl = Math.min(website.zeilen.length, WEBSITE_MAX);
    // Erst die Antworten kürzer, dann weniger Zeilen.
    for (let max = ANTWORT_IN_OFFEN_MAX; max >= ANTWORT_MIN; max -= 100) {
        if (baue(anzahl, max).length <= NACHRICHT_MAX) return baue(anzahl, max);
    }
    let weniger = anzahl;
    while (weniger > 0 && baue(weniger, ANTWORT_MIN).length > NACHRICHT_MAX) weniger -= 1;
    return baue(weniger, ANTWORT_MIN);
}

/**
 * Die Antwort auf `/offen`: die offenen Discord-Fälle (Datenbank) und parallel dazu die eigenen Meldungen von der Website (Brücke, Zeitgrenze 1,5 s). Die Brücke
 * wirft nie; wirft die Datenbank, wirft auch diese Funktion (der Empfänger macht daraus den Satz „gestört“). `melde` bekommt nur die Klasse eines Ausfalls,
 * nie Kennung oder Antwort.
 */
export async function offenAntwort(
    db: Queryable,
    environment: string,
    kennung: string | null,
    bruecke: CommunityBruecke,
    melde?: (grund: BrueckeGrund) => void,
): Promise<string> {
    const [discord, website] = await Promise.all([
        offenSatz(db, environment, kennung),
        kennung === null ? Promise.resolve<OffenErgebnis>({ art: "aus" }) : bruecke.offeneWebsiteMeldungen(kennung),
    ]);
    if (website.art === "ausfall") melde?.(website.grund);
    return offenMitWebsite(discord, website);
}

/**
 * `/erledigt meldung:COM-…`: die eigene Website-Meldung zurückziehen, über die Brücke. Production entscheidet allein, ob die Kennung zur Meldung gehört; eine
 * fremde und eine unbekannte Nummer bekommen denselben Satz. Wirft nie.
 */
export async function websiteZurueckziehenSatz(
    bruecke: CommunityBruecke,
    kennung: string | null,
    nummer: string,
    melde?: (grund: BrueckeGrund) => void,
): Promise<string> {
    if (!bruecke.eingeschaltet) return SAETZE.websiteAus;
    if (kennung === null) return SAETZE.websiteNichtGefunden(nummer);
    const antwort = await bruecke.websiteMeldungZurueckziehen(kennung, nummer);
    if (antwort.art === "aus") return SAETZE.websiteAus;
    if (antwort.art === "ausfall") {
        melde?.(antwort.grund);
        return SAETZE.websiteZurueckNichtErreichbar;
    }
    return antwort.ergebnis === "zurueckgezogen"
        ? SAETZE.websiteZurueckgezogen(nummer)
        : antwort.ergebnis === "schon_abgeschlossen"
          ? SAETZE.websiteSchonAbgeschlossen(nummer)
          : SAETZE.websiteNichtGefunden(nummer);
}
