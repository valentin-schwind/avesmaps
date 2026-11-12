import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * Getarnte Automaten an Mustern erkennen (OPS-000118).
 *
 * Anlass: Am 2026-11-11 rief ein Abrufer aus Netzen der Tencent Cloud (Aceville Pte. Ltd.) die Karte auf, mit echtem Browser, in Schüben von
 * rund zehn Seiten je Sekunde, jede Anfrage von einer anderen Adresse und mit einer anderen Chrome-Version (Claudios Auswertung der
 * Zugriffsprotokolle, `project-control/handovers/2026-11-12-analyse-ops-000118-zugriffe-antwort-an-claudia.md`). Am Browser war er nicht zu
 * erkennen; jede Adresse zählte als neue Person, rund 800 an einem Tag.
 *
 * 🔴 **Land und Dauer entscheiden nie** (Vorgabe im Vorgang). Zwei Gründe, jeder für sich:
 * - **Rechenzentrum:** Die Adresse liegt in einem Netz, das einem Cloud-Betreiber gehört (`RECHENZENTRUM_NETZE`). Menschen surfen nicht von
 *   dort, Abrufer schon.
 * - **Häufung:** Aus einem Netz (/16 bzw. /48) kommen in einer Minute `HAEUFUNG_SCHWELLE` verschiedene neue Personen. Bei rund 900 Personen
 *   am Tag aus Hunderten von Netzen kommt das bei Menschen nicht vor; der Abrufer schaffte es in einer Sekunde. Das Netz bleibt danach
 *   `HAEUFUNG_SPERRE_MS` auffällig.
 *
 * 🔴 **Nichts davon wird gespeichert.** Der Wächter hält im Speicher des Prozesses je Netz die Tageskennungen der letzten Minute (16 Byte
 * HMAC, als Text) und bis wann es auffällig ist; was älter ist, fällt heraus. Keine Adresse, kein Zeitstempel in der Datenbank.
 */

/**
 * Netze von Rechenzentren, aus denen Abrufer kamen (Belege im Kommentar). Bewusst klein und belegt, keine fremde Gesamtliste: Ein falsches
 * Netz hier blendet Menschen aus. Neue Netze kommen mit Beleg aus den Protokollen hinzu.
 */
export const RECHENZENTRUM_NETZE: readonly { netz: string; praefix: number; beleg: string }[] = [
    // whois `ACEVILLEPTELTD-SG`, Aceville Pte. Ltd. (Tencent Cloud); 11.11.: 646 Adressen aus 43.172/16 und 43.173/16.
    { netz: "43.160.0.0", praefix: 12, beleg: "OPS-000118, Tencent Cloud Singapur" },
    // whois `ACEVILLEPTELTD-SG`, „Tencent Cloud Computing (Beijing)“; DB-IP ordnet es Malaysia zu; 11.11.: 142 Adressen.
    { netz: "161.120.0.0", praefix: 16, beleg: "OPS-000118, Tencent Cloud, als Malaysia geführt" },
];

/** So viele verschiedene neue Personen aus einem Netz in `HAEUFUNG_FENSTER_MS` machen es auffällig. */
export const HAEUFUNG_SCHWELLE = 8;
export const HAEUFUNG_FENSTER_MS = 60_000;
/** So lange bleibt ein auffälliges Netz auffällig; der Abrufer kam über den Tag in Schüben wieder. */
export const HAEUFUNG_SPERRE_MS = 30 * 60_000;
/** Ab so vielen Netzen im Speicher wird aufgeräumt; im Fenster einer Minute leben bei uns nur wenige. */
const AUFRAEUMEN_AB = 1000;

/** Warum ein Aufruf als Automat zählt; die Ausprägung von `automat_grund`. */
export type AutomatGrund = "useragent" | "rechenzentrum" | "haeufung";

const rechenzentren = new BlockList();
for (const { netz, praefix } of RECHENZENTRUM_NETZE) rechenzentren.addSubnet(netz, praefix, "ipv4");

/** IPv4 auch dann, wenn die Adresse in IPv6-Schreibweise kommt (`::ffff:43.173.5.9`). */
function alsIPv4(ip: string): string | undefined {
    const ohnePraefix = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    return isIPv4(ohnePraefix) ? ohnePraefix : undefined;
}

export function imRechenzentrum(ip: string): boolean {
    const v4 = alsIPv4(ip);
    return v4 !== undefined && rechenzentren.check(v4, "ipv4");
}

/** Die ersten drei Gruppen einer IPv6-Adresse, `::` ausgeschrieben. */
function ipv6Kopf(ip: string): string {
    const [vorne = "", hinten = ""] = ip.split("::");
    const links = vorne === "" ? [] : vorne.split(":");
    const rechts = ip.includes("::") ? (hinten === "" ? [] : hinten.split(":")) : [];
    const gruppen = [...links, ...Array.from({ length: 8 - links.length - rechts.length }, () => "0"), ...rechts];
    return gruppen
        .slice(0, 3)
        .map((gruppe) => gruppe.toLowerCase().replace(/^0+(?=.)/, ""))
        .join(":");
}

/** Das Netz einer Adresse: IPv4 als /16 (`43.173`), IPv6 als /48 (`2003:e1:abcd`); `undefined` für alles andere. */
export function netzVon(ip: string): string | undefined {
    const v4 = alsIPv4(ip);
    if (v4 !== undefined) return v4.split(".").slice(0, 2).join(".");
    return isIPv6(ip) ? ipv6Kopf(ip) : undefined;
}

/**
 * Merkt sich je Netz die neuen Personen der letzten Minute. Je Instanz der App einer, damit Tests einander nicht stören.
 *
 * 🪤 Gezählt werden **verschiedene Kennungen**, nicht Anfragen: Wer oft kommt, ist eine Person. Der Abrufer wechselt mit jeder Anfrage
 * Adresse und Browserversion und ist darum jedes Mal eine neue.
 */
export class HaeufungsWaechter {
    private readonly netze = new Map<string, { gesehen: Map<string, number>; auffaelligBis: number }>();

    /** Trägt die Kennung ein und sagt, ob das Netz der Adresse gerade auffällig ist. */
    auffaellig(ip: string, kennung: string, jetzt = Date.now()): boolean {
        const netz = netzVon(ip);
        if (netz === undefined) return false;
        if (this.netze.size > AUFRAEUMEN_AB) this.raeumeAuf(jetzt);
        const stand = this.netze.get(netz) ?? { gesehen: new Map<string, number>(), auffaelligBis: 0 };
        this.netze.set(netz, stand);
        for (const [alt, zeit] of stand.gesehen) if (zeit < jetzt - HAEUFUNG_FENSTER_MS) stand.gesehen.delete(alt);
        stand.gesehen.set(kennung, jetzt);
        if (stand.gesehen.size >= HAEUFUNG_SCHWELLE) stand.auffaelligBis = jetzt + HAEUFUNG_SPERRE_MS;
        return stand.auffaelligBis > jetzt;
    }

    /** Ist das Netz gerade auffällig? Ohne einzutragen (für Lebenszeichen, die keine neue Person sind). */
    istAuffaellig(ip: string, jetzt = Date.now()): boolean {
        const netz = netzVon(ip);
        return netz !== undefined && (this.netze.get(netz)?.auffaelligBis ?? 0) > jetzt;
    }

    groesse(): number {
        return this.netze.size;
    }

    private raeumeAuf(jetzt: number): void {
        for (const [netz, stand] of this.netze) {
            const juengste = Math.max(0, ...stand.gesehen.values());
            if (stand.auffaelligBis <= jetzt && juengste < jetzt - HAEUFUNG_FENSTER_MS) this.netze.delete(netz);
        }
    }
}
