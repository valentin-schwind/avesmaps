/**
 * Das Umgebungsmenü an der Pille der Kopfleiste (WI-0180; Betreiber 2026-10-15/16, Probierseite Fassung 4 und §5 im WI): Welche
 * Umgebungen das Menü zeigt, wohin sie führen und ob eine gesperrt ist. Die Regel steht hier und nicht im Bauteil, weil sie aus
 * dem Hostnamen folgt: Auf `localhost` gibt es den Stage-Fall nicht, und ein Browsertest kann ihn deshalb nicht zeigen.
 *
 * 🔴 **Nur mit dem Recht `switch_environment`**, und das hat nur die Rolle `operator` (Betreiber 2026-10-16: „Nur Betreiber“).
 * Alle anderen sehen die Pille wie bisher, als Angabe.
 *
 * 🔴 **Alles außer dem Host wandert mit** (Betreiber 2026-10-14: „richtig cool wär, wenn auch in der URL die ansicht und routen,
 * etc. mit alle ihren einstellungen/parametern erhalten bleiben, also sich nur avesmaps.de/xyz ....stage.avesmaps.de/xyz
 * ändert“). Pfad, Parameter und Fragment bleiben Zeichen für Zeichen stehen; die Adresse trägt den ganzen Zustand schon
 * (Ausschnitt im Fragment, Schalter in `map/display-state.ts`, die Reise als `?route=…`), also auch den Editor-Modus.
 *
 * **Woher die Adresse der Gegenseite kommt:**
 * - Auf Production und Stage folgt sie aus der eigenen (`avesmaps.de` ↔ `stage.avesmaps.de`), wie seit 2026-10-12. Trägt der Host
 *   diese Form nicht, gibt es kein Menü, statt auf eine geratene Adresse zu zeigen.
 * - Lokal folgt sie aus nichts; dort führt das Menü auf die öffentlichen Adressen (`OEFFENTLICHER_HOST`). Betreiber 2026-10-16 zur
 *   Tafel: „die andern beiden sind für die betreiber sichtbar“.
 * - Lokal als ZIEL (WI-0180 §11; Betreiber 2026-10-16: „die adresse von lokalhost bestimmt, ob das obere angezeigt wird“): Die
 *   Adresse steht in den privaten Karteneinstellungen (eingetragen im Reiter „Umgebungen“). Das Menü bekommt sie nur, wenn Lokal
 *   gerade gezeigt werden soll (`lokal`): mit „immer“ stets, mit „wenn erreichbar“ nur, wenn die Probe aus dem Browser antwortet
 *   (`lokal-probe.ts`). Pfad, Parameter und Fragment wandern auch dorthin mit.
 *
 * **Stage gesperrt** (Betreiber 2026-10-16: „und nutzer, die noch nie auf stage eingeloggt waren, sehen stage deaktiviert“, gewählt
 * „Je Browser“): Die Stage setzt nach einer Anmeldung ein Merkzeichen für `avesmaps.de` (`STAGE_MERKZEICHEN`), Production liest es.
 * Lokal kann es nicht lesen (anderer Host), dort gilt die Sperre nicht.
 */

export const UMGEBUNGEN = ["development", "staging", "production"] as const;
export type Umgebung = (typeof UMGEBUNGEN)[number];

export interface UmgebungsEintrag {
    umgebung: Umgebung;
    /** Die Umgebung, in der man gerade ist. Sie führt nirgends hin. */
    aktuell: boolean;
    /** Das Ziel mit Pfad, Parameter und Fragment; `undefined` an der aktuellen. */
    ziel: string | undefined;
    /** Der Host, wie er in der Tafel steht. */
    host: string;
    gesperrt: boolean;
}

/**
 * Die eigene Adresse, soweit die Regel sie braucht. `location` passt unverändert hinein. Der Port zählt nur für die Anzeige
 * (lokal `localhost:5173`); in Ziele wandert er nie.
 */
export type Ort = Pick<Location, "hostname" | "pathname" | "search" | "hash"> & { host?: string };

const STAGE_PRAEFIX = "stage.";
/** Die öffentliche Adresse, auf die das Menü von lokal aus führt; Stage ist `stage.` davor. */
export const OEFFENTLICHER_HOST = "avesmaps.de";

export const STAGE_MERKZEICHEN = "avesmaps-stage-gesehen";
/** So lange hält das Merkzeichen; jeder Besuch der Stage frischt es auf. 400 Tage ist die Obergrenze, die Chrome annimmt. */
const MERKZEICHEN_SEKUNDEN = 400 * 24 * 60 * 60;

function istUmgebung(wert: string | null | undefined): wert is Umgebung {
    return (UMGEBUNGEN as readonly (string | null | undefined)[]).includes(wert);
}

/** Die Hosts aller drei Umgebungen aus Sicht der eigenen, oder `undefined`, wenn sie sich nicht ableiten lassen. */
function hosts(umgebung: Umgebung, ort: Ort): Partial<Record<Umgebung, string>> | undefined {
    const eigener = ort.hostname;
    if (eigener === "") return undefined;
    if (umgebung === "development")
        return {
            development: ort.host ?? eigener,
            staging: `${STAGE_PRAEFIX}${OEFFENTLICHER_HOST}`,
            production: OEFFENTLICHER_HOST,
        };
    // Stünde `production` fälschlich an einer `stage.`-Adresse, entstünde sonst `stage.stage.avesmaps.de`.
    if (umgebung === "production" && !eigener.startsWith(STAGE_PRAEFIX))
        return { staging: `${STAGE_PRAEFIX}${eigener}`, production: eigener };
    if (umgebung === "staging" && eigener.startsWith(STAGE_PRAEFIX))
        return { staging: eigener, production: eigener.slice(STAGE_PRAEFIX.length) };
    return undefined;
}

/**
 * Die Einträge des Menüs in fester Reihenfolge (Lokal, Stage, Production), oder `undefined`: dann bleibt die Pille eine Angabe.
 * `stageGesehen` sagt, ob dieser Browser schon auf der Stage angemeldet war (`stageGesehen(document.cookie)`).
 */
export function umgebungsEintraege(
    darf: boolean,
    umgebung: string | null | undefined,
    ort: Ort,
    stageGesehen: boolean,
    /** Die Adresse von Lokal, wenn Lokal als Ziel erscheinen soll (`https://<name>[:port]`). */
    lokal?: { adresse: string } | undefined,
): UmgebungsEintrag[] | undefined {
    if (!darf || !istUmgebung(umgebung)) return undefined;
    const alle = hosts(umgebung, ort);
    if (alle === undefined) return undefined;
    const lokalHost = umgebung === "development" || lokal === undefined ? undefined : hostVon(lokal.adresse);
    if (lokalHost !== undefined) alle.development = lokalHost;
    const rest = `${ort.pathname}${ort.search}${ort.hash}`;
    const eintraege: UmgebungsEintrag[] = [];
    for (const u of UMGEBUNGEN) {
        const host = alle[u];
        if (host === undefined) continue;
        const aktuell = u === umgebung;
        eintraege.push({
            umgebung: u,
            aktuell,
            ziel: aktuell ? undefined : `https://${host}${rest}`,
            host,
            gesperrt: !aktuell && u === "staging" && umgebung === "production" && !stageGesehen,
        });
    }
    return eintraege;
}

/** Der Host einer Adresse von Lokal, nur bei HTTPS (sonst blockt der Browser sie aus Stage und Production ohnehin). */
function hostVon(adresse: string): string | undefined {
    try {
        const url = new URL(adresse);
        return url.protocol === "https:" && url.pathname === "/" ? url.host : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Springt die Pille direkt (⇄)? Genau dann, wenn es genau ein Ziel gibt und das frei ist (Betreiber 2026-10-16 zur Probierseite:
 * „bei zwei zielen: springt direkt“). Ist das eine Ziel gesperrt, öffnet die Pille die Tafel, damit der Grund dasteht.
 */
export function sprungziel(eintraege: readonly UmgebungsEintrag[]): UmgebungsEintrag | undefined {
    const ziele = eintraege.filter((eintrag) => !eintrag.aktuell);
    return ziele.length === 1 && !ziele[0]!.gesperrt ? ziele[0] : undefined;
}

/** War dieser Browser schon auf der Stage angemeldet? Liest das Merkzeichen aus `document.cookie`. */
export function stageGesehen(cookie: string): boolean {
    return cookie.split(";").some((teil) => teil.trim() === `${STAGE_MERKZEICHEN}=1`);
}

/**
 * Das Merkzeichen, das die Stage nach einer Anmeldung setzt: für die Eltern-Domain (`stage.avesmaps.de` → `avesmaps.de`), damit
 * Production es lesen kann; `undefined` anderswo. Kein Geheimnis, nur „hier schon angemeldet“; die Anmeldetür wertet nur das
 * host-gebundene Sitzungs-Cookie aus (Claudio 2026-10-16). Mit `behalten = false` räumt derselbe Satz es ab: Nur Betreiber brauchen
 * es, und die Hinweise nennen es nicht (Betreiber 2026-11-03).
 */
export function stageMerkzeichen(
    umgebung: string | null | undefined,
    hostname: string,
    behalten: boolean,
): string | undefined {
    if (umgebung !== "staging" || !hostname.startsWith(STAGE_PRAEFIX)) return undefined;
    const eltern = hostname.slice(STAGE_PRAEFIX.length);
    const sekunden = behalten ? MERKZEICHEN_SEKUNDEN : 0;
    return `${STAGE_MERKZEICHEN}=1; Domain=${eltern}; Path=/; Max-Age=${String(sekunden)}; Secure; SameSite=Lax`;
}
