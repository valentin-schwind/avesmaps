/**
 * Die Zählung der Beiträge im Social Hub (WI-0270 C11; Fachkonzept `project-control/planning/community-fachkonzept.md` §15.6,
 * Recherche `project-control/discovery/social-zeichengrenzen-2026-10-31.md`).
 *
 * 🔴 **Eine Zählung für Fenster und Server.** Dieses Modul rechnet im Browser (Zähler, Vorschau, gesperrte Knöpfe) und auf dem Server (Vorlegen,
 * Freigeben, Änderung veröffentlichen) mit denselben Regeln; gesendet wird nur, was der Server hiermit nachgezählt hat. Legacy hatte die Zählung
 * doppelt (PHP und JavaScript) und brauchte lange, bis die Grenzen stimmten.
 *
 * - **Jeder Kanal ist eine Zeile Daten** (`ZAEHLREGELN`), kein Sonderfall im Ablauf: Grenze, Einheit, zweite Grenze in Bytes, Länge einer
 *   Adresse, Erwähnung, Inhaltswarnung, wie viele Hashtags der Kanal bekommt, dazu Quelle und Prüfdatum.
 * - **Gezählt wird, wie der Dienst zählt; wo er es nicht sagt, vorsichtig.** Zu streng zählen ist harmlos, zu großzügig zählen ist ein Fehler, den man
 *   öffentlich sieht: Discord und Instagram zählen in UTF-16-Einheiten (die größte Einheit), Facebook hat keine offizielle Grenze (63 206 nur
 *   sekundär belegt).
 * - **Hashtags** bekommt jeder Kanal höchstens in der Zahl seiner Zeile (Legacy, `compose-test.php`): die ersten so vielen werden an den Text gehängt
 *   und zählen mit; die übrigen fallen weg. Die Neuigkeiten bekommen keine (dort wären sie toter Text).
 * - **Der Zähler nennt den engsten Kanal** (Guide §13.21: „Ein Zähler nennt die Quelle seiner Grenze“): den gewählten, dem am wenigsten Platz bleibt;
 *   läuft einer über, steht er vorn.
 * - Grapheme zählt `Intl.Segmenter` (Unicode-Graphemcluster wie bei Mastodon). Fehlt er (alter Browser), zählt der Hub Codepoints: das ist
 *   mehr oder gleich viel, also zu streng, nie zu großzügig.
 */

/** Die Kanäle des Hubs. `neuigkeiten` ist die Seite auf avesmaps.de; die übrigen sind fremde Dienste (eigener Auftrag je Kanal, Umsetzungsplan C12). */
export const KANAL_IDS = ["neuigkeiten", "discord", "mastodon", "instagram", "facebook"] as const;
export type KanalId = (typeof KANAL_IDS)[number];

/**
 * Die Kanäle, die immer da sind (die Seite auf avesmaps.de). Alle anderen stehen mit Zähler und Vorschau da und senden erst, wenn der Server sie meldet: eingerichtet, freigeschaltet und ohne Notschalter
 * (`SocialKanalStand.bereit`, WI-0268 C12a; `kanalKontext` in `community-social.ts` macht daraus die Liste der verbundenen Kanäle).
 */
export const KANAL_VERBUNDEN: readonly KanalId[] = ["neuigkeiten"];
export const kanalVerbunden = (id: KanalId, verbunden: readonly KanalId[] = KANAL_VERBUNDEN): boolean =>
    verbunden.includes(id);

/**
 * Die Kanäle mit eigenem Zugang und eigenem Gate (`kanal_stand` in der Datenbank): Mastodon (C12a), Facebook und Instagram (C12b), nach Valis Satz „alle wie in Legacy“ (E11). Jeder wird erst nach SEINEM Prüflauf
 * (`social:pruefen`) freigeschaltet; die drei gehen gemeinsam live, weil keiner ohne Prüflauf erscheint (Vali 2026-11-01: „stopp nein wir machen alles auf einmal live“). Dazu Discord (Vali 2026-11-03: Beiträge landen in
 * „Neue Features“): sein Prüflauf liest nur den Webhook und schickt nichts (`social/pruefen-discord.ts`).
 */
export const KANAL_MIT_ZUGANG = ["mastodon", "facebook", "instagram", "discord"] as const satisfies readonly KanalId[];
export type KanalMitZugang = (typeof KANAL_MIT_ZUGANG)[number];
export const hatZugang = (id: KanalId): id is KanalMitZugang => (KANAL_MIT_ZUGANG as readonly string[]).includes(id);

export function istKanalId(wert: string): wert is KanalId {
    return (KANAL_IDS as readonly string[]).includes(wert);
}

/** Wie ein Dienst die Länge misst: Graphemcluster, UTF-16-Einheiten oder Codepoints (`zeichen`, wie Postgres `char_length`). */
export type ZaehlEinheit = "grapheme" | "utf16" | "zeichen";

export interface ZaehlRegel {
    readonly id: KanalId;
    /** Der Eigenname des Dienstes; er wird nicht übersetzt. */
    readonly name: string;
    /** Die Grenze des Textes in `einheit`. */
    readonly grenze: number;
    readonly einheit: ZaehlEinheit;
    /** Die zweite Grenze in Bytes (UTF-8), die ein Dienst neben der ersten prüfen kann; keine heutige Regel setzt sie (Bluesky, das sie hatte, ist aus dem Hub entfernt). */
    readonly bytes?: number;
    /** Jede Adresse mit `http(s)://` zählt so viel, wie lang sie auch ist (Mastodon: 23); ohne Protokoll zählt sie voll. */
    readonly adresse?: number;
    /** Eine Erwähnung einer fremden Instanz (`@name@instanz`) zählt nur als `@name` (Mastodon). */
    readonly erwaehnungLokal?: true;
    /** Die Inhaltswarnung (`spoiler_text`) zählt mit dem Text zusammen (Mastodon). */
    readonly warnungZaehlt?: true;
    /** Wie viele Hashtags der Kanal bekommt (redaktioneller Wert, nicht der des Dienstes). */
    readonly hashtags: number;
    /** Die Titelzeile hat eine eigene Grenze (nur die Neuigkeiten). */
    readonly titelGrenze?: number;
    /** Ohne Bild geht nichts raus (Instagram). */
    readonly bildPflicht?: true;
    /** Woher die Zahlen stammen und wann sie zuletzt gegen den Dienst geprüft wurden (Recherche §5: vor jedem Kanal gegen ein Testkonto). */
    readonly quelle: string;
    readonly geprueft: string;
    /** Keine offizielle Angabe: Die Zahl ist eine Vorsicht, kein Beleg. */
    readonly unsicher?: true;
}

const RECHERCHE = "social-zeichengrenzen-2026-10-31.md";

/**
 * Die Zählregeln der Kanäle. Stand 2026-10-31 aus der Recherche; Mastodon liest seine Grenzen beim Verbinden und täglich von der Instanz
 * (`/api/v2/instance`, WI-0268 C12a) und überschreibt diese Vorgaben für seine Instanz (`mastodonRegel`, `KanalRegeln`).
 */
export const ZAEHLREGELN: Readonly<Record<KanalId, ZaehlRegel>> = {
    neuigkeiten: {
        id: "neuigkeiten",
        name: "Neuigkeiten",
        grenze: 4000,
        einheit: "zeichen",
        titelGrenze: 200,
        hashtags: 0,
        quelle: `Schema \`news.ts\` und Migration 0119 (${RECHERCHE} §2)`,
        geprueft: "2026-10-31",
    },
    discord: {
        id: "discord",
        name: "Discord",
        grenze: 2000,
        einheit: "utf16",
        hashtags: 0,
        quelle: `Discord-Dokumentation, Einheit nicht definiert, vorsichtig UTF-16 (${RECHERCHE} §2)`,
        geprueft: "2026-10-31",
        unsicher: true,
    },
    mastodon: {
        id: "mastodon",
        name: "Mastodon",
        grenze: 500,
        einheit: "grapheme",
        adresse: 23,
        erwaehnungLokal: true,
        warnungZaehlt: true,
        hashtags: 4,
        quelle: `Mastodon v4.7.4, status_length_validator.rb (${RECHERCHE} §2)`,
        geprueft: "2026-10-31",
    },
    instagram: {
        id: "instagram",
        name: "Instagram",
        grenze: 2200,
        einheit: "utf16",
        hashtags: 5,
        bildPflicht: true,
        quelle: `Instagram Graph API; Einheit nicht dokumentiert, vorsichtig UTF-16 (${RECHERCHE} §2)`,
        geprueft: "2026-10-31",
        unsicher: true,
    },
    facebook: {
        id: "facebook",
        name: "Facebook",
        grenze: 63206,
        einheit: "zeichen",
        hashtags: 2,
        quelle: `keine offizielle Angabe, 63 206 nur sekundär (${RECHERCHE} §2)`,
        geprueft: "2026-10-31",
        unsicher: true,
    },
};

export const zaehlRegel = (id: KanalId): ZaehlRegel => ZAEHLREGELN[id];

/**
 * Die Zählregeln, die ein Kanal von seinem Dienst bekommen hat, ersetzen die Vorgaben von `ZAEHLREGELN` (WI-0268 C12a, Fachkonzept §15.6: „Mastodon-Grenzen liest der Server von der Instanz“).
 * Fehlt ein Kanal hier, gilt seine Vorgabe. Fenster und Server bekommen dieselbe Tafel aus `GET /api/community/social/kanaele` bzw. aus der Datenbank.
 */
export type KanalRegeln = Readonly<Partial<Record<KanalId, ZaehlRegel>>>;

/** Die Regel eines Kanals: die gelesene, sonst die Vorgabe. */
export const regelFuer = (id: KanalId, regeln?: KanalRegeln): ZaehlRegel => regeln?.[id] ?? ZAEHLREGELN[id];

/**
 * Die Grenzen, die eine Mastodon-Instanz von sich nennt (`GET /api/v2/instance`): `configuration.statuses.max_characters`, `characters_reserved_per_url`, `max_media_attachments`,
 * `configuration.media_attachments.description_limit`, `image_size_limit` und `supported_mime_types`. Ein anderer Server oder ein Fork wie glitch-soc kann andere Werte haben.
 */
export interface MastodonGrenzen {
    readonly zeichen: number;
    readonly adresse: number;
    readonly bilder: number;
    readonly beschreibung: number;
    readonly bildBytes: number;
    readonly bildTypen: readonly string[];
}

/** Die Zählregel für Mastodon aus den gelesenen Grenzen: alles wie in der Vorgabe, nur Grenze und Länge einer Adresse kommen von der Instanz. */
export function mastodonRegel(grenzen: Pick<MastodonGrenzen, "zeichen" | "adresse">, gelesen: string): ZaehlRegel {
    return {
        ...ZAEHLREGELN.mastodon,
        grenze: grenzen.zeichen,
        adresse: grenzen.adresse,
        quelle: `Instanz, /api/v2/instance (${RECHERCHE} §3)`,
        geprueft: gelesen,
    };
}

// --- Rechnen ------------------------------------------------------------------------------------------------------------------------

let segmentierer: Intl.Segmenter | null | undefined;
function graphemeSegmentierer(): Intl.Segmenter | null {
    if (segmentierer === undefined) {
        segmentierer =
            typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
                ? new Intl.Segmenter("en", { granularity: "grapheme" })
                : null;
    }
    return segmentierer;
}

/** Graphemcluster (Mastodon); ohne `Intl.Segmenter` Codepoints, also eher zu viel als zu wenig. */
export function zaehleGrapheme(text: string): number {
    const s = graphemeSegmentierer();
    if (s === null) return Array.from(text).length;
    return Array.from(s.segment(text)).length;
}

/** Codepoints, wie Postgres `char_length` und die Längenprüfung des Schemas zählen. */
export const zaehleZeichen = (text: string): number => Array.from(text).length;

/** UTF-16-Einheiten (`String.length`, vorsichtig für Discord und Instagram). */
export const zaehleUtf16 = (text: string): number => text.length;

const kodierer = typeof TextEncoder === "function" ? new TextEncoder() : null;
/** Bytes in UTF-8 (für die zweite Grenze einer Regel, `ZaehlRegel.bytes`). */
export function zaehleBytes(text: string): number {
    if (kodierer !== null) return kodierer.encode(text).length;
    let n = 0;
    for (const zeichen of text) {
        const c = zeichen.codePointAt(0) ?? 0;
        n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return n;
}

export function zaehleIn(einheit: ZaehlEinheit, text: string): number {
    return einheit === "grapheme"
        ? zaehleGrapheme(text)
        : einheit === "utf16"
          ? zaehleUtf16(text)
          : zaehleZeichen(text);
}

/**
 * Eine Adresse mit `http(s)://` (Mastodon: `FetchLinkCardService::URL_PATTERN`): nicht hinter einem Wortzeichen, `=` oder `/`; Satzzeichen am Ende gehören
 * dem Satz, nicht der Adresse (sie zählen einzeln, also eher zu viel). `example.org` ohne Protokoll ist keine Adresse und zählt voll.
 */
const ADRESSE = /(?<![=/\p{L}\p{N}_])https?:\/\/[^\s<>"]+/gu;
const ADRESSE_ENDE = /[.,;:!?)\]}'"»”’…]+$/u;
/** `@name@instanz`, Mastodon: `Account::MENTION_RE`. Die Instanz fällt weg, der Name bleibt. */
const ERWAEHNUNG = /(?<![=/\p{L}\p{N}_])@([a-z0-9_]+(?:[a-z0-9_.-]+[a-z0-9_]+)?)(?:@[\p{L}\p{N}_.-]+[\p{L}\p{N}_]+)/giu;

function ersetzeAdressen(text: string, laenge: number): string {
    return text.replace(ADRESSE, (treffer) => {
        const ende = ADRESSE_ENDE.exec(treffer)?.[0] ?? "";
        // Bleibt von der Adresse nach dem Abschneiden nichts als das Protokoll, ist es keine.
        const kern = treffer.slice(0, treffer.length - ende.length);
        return /^https?:\/\/./u.test(kern) ? "x".repeat(laenge) + ende : treffer;
    });
}

/** Das Eingegebene, wie es ein Beitrag trägt. `warnung` ist die Inhaltswarnung (Mastodon `spoiler_text`); der Hub speichert sie noch nicht. */
export interface ZaehlEingabe {
    readonly titel?: string | undefined;
    readonly text: string;
    readonly hashtags: readonly string[];
    readonly warnung?: string | undefined;
}

/** Was ein Kanal bekommt: der Text, dann die ersten so vielen Hashtags, die er nimmt. `weg` zählt die, die wegfallen. */
export function fassungFuer(
    regel: ZaehlRegel,
    eingabe: ZaehlEingabe,
): { text: string; hashtags: string[]; weg: number } {
    const genommen = eingabe.hashtags.slice(0, regel.hashtags);
    return {
        text: genommen.length > 0 ? `${eingabe.text}\n\n${genommen.join(" ")}` : eingabe.text,
        hashtags: [...genommen],
        weg: eingabe.hashtags.length - genommen.length,
    };
}

export interface KanalStand {
    readonly kanal: KanalId;
    readonly regel: ZaehlRegel;
    /** Gezählt in `regel.einheit`: Text samt angehängter Hashtags (und Inhaltswarnung, wo sie mitzählt). */
    readonly n: number;
    readonly grenze: number;
    /** Wie viel der Text über der Grenze liegt, sonst 0. */
    readonly zuviel: number;
    /** UTF-8-Bytes, wo der Kanal eine zweite Grenze in Bytes hat, sonst `null`. */
    readonly bytes: number | null;
    readonly bytesGrenze: number | null;
    readonly zuvielBytes: number;
    /** Wie viele Hashtags dieser Kanal nicht bekommt. */
    readonly hashtagsWeg: number;
    /** Die Titelzeile, wo der Kanal eine hat. */
    readonly titel: { readonly n: number; readonly grenze: number; readonly zuviel: number } | null;
    /** Läuft etwas über (Text, Bytes oder Titelzeile)? */
    readonly ueber: boolean;
    /** Platz, der bis zur Grenze bleibt (negativ: darüber); bei zwei Grenzen die enger gefüllte. */
    readonly frei: number;
}

/** Zählt einen Beitrag für einen Kanal nach dessen Regel. */
export function zaehleKanal(id: KanalId, eingabe: ZaehlEingabe, regeln?: KanalRegeln): KanalStand {
    const regel = regelFuer(id, regeln);
    const fassung = fassungFuer(regel, eingabe);
    let zaehlbar = fassung.text;
    if (regel.adresse !== undefined) zaehlbar = ersetzeAdressen(zaehlbar, regel.adresse);
    if (regel.erwaehnungLokal === true) zaehlbar = zaehlbar.replace(ERWAEHNUNG, "@$1");
    if (regel.warnungZaehlt === true && eingabe.warnung !== undefined) zaehlbar = `${eingabe.warnung}${zaehlbar}`;
    const n = zaehleIn(regel.einheit, zaehlbar);
    const zuviel = Math.max(0, n - regel.grenze);
    // Bytes zählen den Text, wie er gesendet wird (ohne Ersatz der Adressen: im Text steht sie voll).
    const bytes = regel.bytes === undefined ? null : zaehleBytes(fassung.text);
    const zuvielBytes = regel.bytes === undefined || bytes === null ? 0 : Math.max(0, bytes - regel.bytes);
    // Die Titelzeile gehört nur dem Kanal, der sie hat; der Hub zählt sie wie die Seite, in Codepoints und ohne Leerraum an den Rändern.
    const titelText = eingabe.titel?.trim() ?? "";
    const titel =
        regel.titelGrenze === undefined
            ? null
            : {
                  n: zaehleZeichen(titelText),
                  grenze: regel.titelGrenze,
                  zuviel: Math.max(0, zaehleZeichen(titelText) - regel.titelGrenze),
              };
    const frei = Math.min(
        regel.grenze - n,
        regel.bytes === undefined || bytes === null ? Infinity : regel.bytes - bytes,
    );
    return {
        kanal: id,
        regel,
        n,
        grenze: regel.grenze,
        zuviel,
        bytes,
        bytesGrenze: regel.bytes ?? null,
        zuvielBytes,
        hashtagsWeg: fassung.weg,
        titel,
        ueber: zuviel > 0 || zuvielBytes > 0 || (titel?.zuviel ?? 0) > 0,
        frei,
    };
}

/** Alle gewählten Kanäle, jeder für sich, in der Reihenfolge der Auswahl. */
export function zaehleAlle(kanaele: readonly KanalId[], eingabe: ZaehlEingabe, regeln?: KanalRegeln): KanalStand[] {
    return kanaele.map((id) => zaehleKanal(id, eingabe, regeln));
}

/** Die Rangzahl für „engster Kanal“: Wer überläuft, steht vor jedem, dem noch Platz bleibt, und der stärkere Überlauf vor dem schwächeren. */
function enge(stand: KanalStand): number {
    if (stand.zuviel > 0) return -stand.zuviel;
    if (stand.zuvielBytes > 0) return -stand.zuvielBytes;
    if ((stand.titel?.zuviel ?? 0) > 0) return -(stand.titel?.zuviel ?? 0);
    return stand.frei;
}

/** Der Kanal, dem am wenigsten Platz bleibt (der Zähler nennt ihn); bei Gleichstand der erste der Auswahl. Ohne Kanal `null`. */
export function engsterKanal(staende: readonly KanalStand[]): KanalStand | null {
    let engster: KanalStand | null = null;
    for (const stand of staende) {
        if (engster === null || enge(stand) < enge(engster)) engster = stand;
    }
    return engster;
}

/** Was an einem Kanal überläuft, mit Größe und Einheit: der Grund, der „Freigeben“ sperrt. */
export type Ueberlauf =
    | { readonly art: "text"; readonly kanal: KanalId; readonly zuviel: number; readonly einheit: ZaehlEinheit }
    | { readonly art: "bytes"; readonly kanal: KanalId; readonly zuviel: number }
    | { readonly art: "titel"; readonly kanal: KanalId; readonly zuviel: number };

/** Der erste Überlauf unter den Ständen, sonst `null`. Titel vor Text vor Bytes, weil der Titel der Seite am schnellsten zu kürzen ist. */
export function ersterUeberlauf(staende: readonly KanalStand[]): Ueberlauf | null {
    for (const stand of staende) {
        if (stand.titel !== null && stand.titel.zuviel > 0) {
            return { art: "titel", kanal: stand.kanal, zuviel: stand.titel.zuviel };
        }
        if (stand.zuviel > 0) {
            return { art: "text", kanal: stand.kanal, zuviel: stand.zuviel, einheit: stand.regel.einheit };
        }
        if (stand.zuvielBytes > 0) return { art: "bytes", kanal: stand.kanal, zuviel: stand.zuvielBytes };
    }
    return null;
}

/** Die Prüfung vor dem Vorlegen und Freigeben: der erste Überlauf unter den gewählten Kanälen. Der Server ruft genau diese Funktion. */
export function pruefeLaenge(
    kanaele: readonly KanalId[],
    eingabe: ZaehlEingabe,
    regeln?: KanalRegeln,
): Ueberlauf | null {
    return ersterUeberlauf(zaehleAlle(kanaele, eingabe, regeln));
}
