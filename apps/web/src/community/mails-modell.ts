import {
    ANFRAGE_KATEGORIEN,
    COMMUNITY_GRENZEN,
    istMailAdresse,
    roundMapCoordinate,
    type AlsMeldungBody,
    type CommunityLage,
    type FehltArt,
    type GesendetZeile,
    type MailWeg,
    type MailZustellstand,
    type MeldungKategorie,
    type SearchHit,
    type VorgangListe,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import { isMessageKey, t } from "../i18n/i18n";
import { codepunkte, zuLangSatz } from "./redaktion-ablehnung";
import {
    kategorieName,
    zeitAbstand,
    zustaendigName,
    type Kreis,
    type VorgangLage,
    type HandgriffStand,
} from "./meldungen-modell";

/**
 * Das Modell des Reiters „Community › Mails“ und der Anfragen im Vorgangsfenster, ohne Vue und ohne Browser (WI-0268 C4; Bedienkonzept WI-0263 §3.2 bis §3.4, §4): die Zeile in der Kartenbauart des
 * Mail-Eingangs (Guide §13.27), die Aktionsspalte, die Ablagen, die Legende, der Fuß „Notiz | Antwort“ samt Sperrgründen und das Blatt „Als Meldung weiterführen“. Die Bauteile zeichnen nur, was hier
 * steht; Vitest prüft es ohne Browser (`test/community-mails.test.ts`).
 *
 * - 🔴 **Gesperrt heißt: ein Satz** (Guide §7, §13.19), wie in `meldungen-modell.ts`. Was der Server entscheidet (Rechte, Übergänge, Revision), bleibt beim Server; dieses Modell blendet nur aus, was nicht
 *   passt, und sagt warum.
 * - **Mails kennen nur Eingang, Gesendet und Archiv** (Fachkonzept §4.1): „Ins Archiv“ ist der Abschluss, ohne Begründung; „Zurück in den Eingang“ öffnet ohne Grund. Gesendet ist keine Ablage, sondern
 *   eine Sicht auf die ausgehenden Nachrichten.
 * - **Ohne Mailweg** geht jede Antwort auf die Statusseite; die Knöpfe sagen es („Antworten (Statusseite)“). **Mit Mailweg** (C6a, `GET /api/community/stand` meldet `mailweg`) heißt der Knopf „Antworten“, die
 *   Zeile darüber „An: ‹Adresse›“, und im Verlauf steht je ausgehender Mail der Zustellstand. HTML, Bilder und Anhänge kommen mit dem Abruf (C6b).
 */

// --- Ablagen und Zahlen -----------------------------------------------------------------------------------------------------

export const MAIL_ABLAGEN = ["eingang", "gesendet", "archiv"] as const;
export type MailAblage = (typeof MAIL_ABLAGEN)[number];

/** Das Segment der Anfrage an den Server; Gesendet ist keine Ablage und fragt eine eigene Liste. */
export const segmentVon = (ablage: MailAblage): "eingang" | "archiv" => (ablage === "gesendet" ? "eingang" : ablage);

/**
 * Die Zahl am Unterreiter: was auf die Redaktion wartet, neue und in Arbeit; „wartet auf Antwort“ wartet auf den Absender und zählt nicht (Bedienkonzept §1.1: „offene Anfragen“).
 * `undefined`, solange es keine Liste gibt.
 */
export const unterreiterZahl = (liste: Pick<VorgangListe, "zaehler"> | undefined): number | undefined =>
    liste === undefined ? undefined : liste.zaehler.neu + liste.zaehler.inArbeit;

/** Die Zahl am Segment Eingang oder Archiv (Gesendet trägt keine: Es ist eine Sicht, die nicht zählt, was in den Ablagen liegt). */
export function ablageZahl(zaehler: VorgangListe["zaehler"], ablage: MailAblage): number | undefined {
    if (ablage === "eingang") return zaehler.eingang;
    return ablage === "archiv" ? zaehler.archiv : undefined;
}

// --- Die Zeile in der Kartenbauart des Mail-Eingangs ------------------------------------------------------------------------

/** Der Absender kräftig: der Name, sonst die Adresse, sonst „ohne Namen“ (Name und Adresse fallen nach der Frist weg). */
export const mailAbsender = (zeile: Pick<VorgangZeile, "absender">): string =>
    zeile.absender ?? t("community.mails.ohneName");

/** Der Betreff gedämpft: die erste Zeile der Nachricht; fehlt sie (Text gelöscht), die Kategorie. */
export const mailBetreff = (zeile: Pick<VorgangZeile, "betreff" | "kategorie">): string =>
    zeile.betreff === null || zeile.betreff === undefined || zeile.betreff === ""
        ? kategorieName(zeile.kategorie)
        : zeile.betreff;

/** Der Eingang als Wort („Kontaktformular“); eine unbekannte Art bleibt, wie sie kommt. */
export const eingangName = (eingang: string): string => {
    const key = `community.redaktion.eingang.${eingang}`;
    return isMessageKey(key) ? t(key) : eingang;
};

/** Die Meta-Zeile: „COM-000124 · Kontaktformular · niemand zuständig“ (Bedienkonzept §3.2: Nummer, Eingang, zuständig). */
export function mailMeta(zeile: Pick<VorgangZeile, "nummer" | "eingang" | "zustaendig">): string {
    return [zeile.nummer, mailEingangName(zeile.eingang), zustaendigName(zeile)].join(" · ");
}

/**
 * Die Adresse als `mailto:`-Verweis. 🔴 Sie ist Eingabe von außen: Was aus ihr mehr machen könnte als EINE Empfängeradresse (`?bcc=…`, `&body=…`, mehrere Empfänger mit Komma oder Strichpunkt, ein Fragment), wird
 * kodiert, bevor ein Mailprogramm sie liest; das `@` bleibt, wie es ist.
 */
export const mailtoVon = (adresse: string): string =>
    `mailto:${adresse.trim().replace(/[%?&#=/;,\s]/gu, (zeichen) => encodeURIComponent(zeichen))}`;

/** Zeigt die Karte das Abzeichen „✓ beantwortet“? Wenn eine Antwort der Redaktion ausging. */
export const istBeantwortet = (zeile: Pick<VorgangZeile, "beantwortet">): boolean => zeile.beantwortet === true;

/** Der Kreis vor dem Absender: neu ○, in Arbeit ◐, wartet auf Antwort ◑, abgeschlossen ●. */
export const MAIL_ZUSTAND_NAME: Readonly<Record<VorgangZeile["zustand"], MessageKey>> = {
    neu: "community.redaktion.zustand.neu",
    in_arbeit: "community.redaktion.zustand.in_arbeit",
    rueckfrage: "community.mails.zustand.rueckfrage",
    abgeschlossen: "community.mails.zustand.archiv",
};

/** Die Legende unten, EINE Zeile: im Eingang die drei Stufen, im Archiv „im Archiv“. */
export function mailLegendeNamen(ablage: MailAblage): Partial<Record<Kreis, string>> {
    if (ablage === "archiv") return { voll: t(MAIL_ZUSTAND_NAME.abgeschlossen) };
    return {
        leer: t(MAIL_ZUSTAND_NAME.neu),
        halb: t(MAIL_ZUSTAND_NAME.in_arbeit),
        "halb-rechts": t(MAIL_ZUSTAND_NAME.rueckfrage),
    };
}

/** Die Kategorien des Trichters: die sechs der Anfragen (Fachkonzept §3.2). */
export const MAIL_FILTER_KATEGORIEN = ANFRAGE_KATEGORIEN;

/** Die Zustände des Trichters im Eingang (Gesendet und Archiv haben keine Stufen). */
export const MAIL_OFFENE_ZUSTAENDE = ["neu", "in_arbeit", "rueckfrage"] as const;

// --- Die Aktionsspalte der Zeile ------------------------------------------------------------------------------------------

/** Was die Aktionsspalte neben einer Karte tut: ↧ Ins Archiv (im Archiv ↺ Zurück in den Eingang) und ✕ In den Papierkorb. */
export interface MailAktionen {
    /** Im Archiv ist es ↺, sonst ↧. */
    readonly archiv: "ins-archiv" | "zurueck";
    readonly korb: HandgriffStand;
}

/**
 * Die Aktionen einer Zeile (Bedienkonzept §3.4). Der Papierkorb braucht `moderate_community` (Server: `community_forbidden`) und steht ohne das Recht gesperrt da, mit dem Satz dazu. Im Papierkorb gibt es
 * keine Aktionsspalte, dort holt man die Anfrage über das Fenster zurück.
 */
export function mailAktionen(ablage: MailAblage, rechte: readonly string[]): MailAktionen {
    return {
        archiv: ablage === "archiv" ? "zurueck" : "ins-archiv",
        korb:
            rechte.includes("moderate_community") || rechte.includes("trash_mail")
                ? { zeigen: true }
                : { zeigen: true, grund: "community.mails.grund.korb" },
    };
}

// --- Gesendet ---------------------------------------------------------------------------------------------------------------

/**
 * „An: alrike@example.org“ bei einer Mail, „An: Statusseite“ bei einer Antwort auf die Statusseite. Eine Mail, deren Adresse nach der Frist wegfiel, sagt es (sie ging nie auf die Statusseite).
 */
export const gesendetAn = (zeile: Pick<GesendetZeile, "an"> & { weg?: string | undefined }): string => {
    if (zeile.an !== null) return t("community.mails.gesendet.an", { adresse: zeile.an });
    return zeile.weg === "mail"
        ? t("community.mails.gesendet.anAbgelaufen")
        : t("community.mails.gesendet.anStatusseite");
};

/**
 * Der Betreff einer ausgehenden Nachricht: bei einer Mail der, mit dem sie hinausging (mit der Nummer); sonst „Re: …“ (Bedienkonzept §3.3), ohne Betreff nur „Re:“.
 */
export const gesendetBetreff = (
    zeile: Pick<GesendetZeile, "betreff"> & { zustellung?: { betreff: string } | undefined },
): string => {
    if (zeile.zustellung !== undefined && zeile.zustellung.betreff !== "") return zeile.zustellung.betreff;
    return zeile.betreff === null || zeile.betreff === ""
        ? t("community.mails.gesendet.reLeer")
        : `Re: ${zeile.betreff}`;
};

/** Der Zustellstand einer Zeile in „Gesendet“: nur bei einer Mail (`undefined` bei einer Antwort auf die Statusseite). */
export const gesendetZustellung = (zeile: Pick<GesendetZeile, "zustellung">): string | undefined =>
    zeile.zustellung === undefined ? undefined : zustellSatz(zeile.zustellung);

/** „COM-000124 · von Vali“ unter dem Betreff. */
export function gesendetMeta(zeile: Pick<GesendetZeile, "nummer" | "von">): string {
    return zeile.von === null || zeile.von.name === ""
        ? zeile.nummer
        : `${zeile.nummer} · ${t("community.mails.gesendet.von", { name: zeile.von.name })}`;
}

export const gesendetZeit = (zeile: Pick<GesendetZeile, "at">, jetzt: Date = new Date()): string =>
    zeitAbstand(zeile.at, jetzt);

// --- Anfragen im Vorgangsfenster --------------------------------------------------------------------------------------------

/** Was das Fenster einer Anfrage anders macht als das einer Meldung (Bedienkonzept §3.2, §3.3, §3.4). */
export interface AnfrageGriffe {
    /** ↧ Ins Archiv in der Leiste: bei Offenem. */
    readonly insArchiv: HandgriffStand;
    /** ↺ Zurück in den Eingang in der Leiste: bei Abgeschlossenem außerhalb des Papierkorbs. */
    readonly zurueck: HandgriffStand;
    /** Menü ⋯ › „Als Meldung weiterführen“. */
    readonly alsMeldung: HandgriffStand;
}

export function anfrageGriffe(lage: Pick<VorgangLage, "zeile" | "papierkorb" | "archiviert">): AnfrageGriffe {
    const zu = lage.zeile.zustand === "abgeschlossen";
    return {
        insArchiv: { zeigen: !zu && !lage.papierkorb },
        zurueck: { zeigen: zu && !lage.papierkorb },
        alsMeldung: { zeigen: !lage.papierkorb },
    };
}

/**
 * Geht eine Antwort, und wenn nicht, warum nicht (Bedienkonzept §3.3)? In der Reihenfolge, in der der Grund am ehesten zählt: das Recht (`answer_community`, eine Antwort vertritt Avesmaps nach
 * außen), der Papierkorb, das Archiv (erst zurück in den Eingang holen), ein fehlender Rückweg (der Absender hat die Statusseite nicht mehr: Name und Link fielen nach der Frist weg).
 */
export function antwortGrund(
    lage: Pick<VorgangLage, "zeile" | "papierkorb" | "archiviert" | "rueckwege">,
    rechte: readonly string[],
): MessageKey | undefined {
    if (!rechte.includes("answer_community")) return "community.mails.grund.antwortRecht";
    if (lage.papierkorb) return "community.redaktion.grund.imPapierkorb";
    if (lage.zeile.zustand === "abgeschlossen") return "community.mails.grund.imArchiv";
    if (lage.rueckwege.length === 0) return "community.mails.grund.keinRueckweg";
    return undefined;
}

/** Warum „Antworten“ gerade nicht geht: der Grund der Lage, sonst fehlender Text; `undefined`, wenn es geht. */
export function antwortSperre(grund: MessageKey | undefined, text: string): MessageKey | undefined {
    if (grund !== undefined) return grund;
    return text.trim() === "" ? "community.redaktion.grund.textFehlt" : undefined;
}

/** Die Zeile über dem Textfeld im Modus Antwort (Bedienkonzept §3.3: „An: …“) ohne Mailweg: die Statusseite. */
export const ANTWORT_AN: MessageKey = "community.mails.antwort.anStatusseite";

/**
 * Wohin eine Antwort geht (WI-0268 C6a, Bedienkonzept §3.3): als Mail, wenn der Mailweg an ist UND der Absender eine einzelne gültige Adresse hat; sonst auf die Statusseite, wenn er sie nutzt; sonst nirgends
 * (`undefined`: Die Antwort ist gesperrt, `keinRueckweg`). 🔴 Die Adresse prüft hier dasselbe Muster wie der Server (`istMailAdresse`): Eine, die der Server nie ansteuerte, macht aus dem Knopf keine Mail.
 */
export function antwortWeg(
    rueckwege: readonly string[],
    mailweg: boolean,
    adresse: string | null | undefined,
): MailWeg | undefined {
    if (mailweg && adresse !== null && adresse !== undefined && istMailAdresse(adresse.trim())) return "mail";
    if (rueckwege.includes("statusseite")) return "statusseite";
    // Aus Discord, ohne Statuslink und Adresse (WI-0297): Der Absender liest die Antwort mit `/offen`.
    return rueckwege.includes("discord") ? "discord" : undefined;
}

/** Die Rückwege, über die eine Antwort wirklich hinausgeht: ohne Mailweg oder ohne gültige Adresse zählt `mail` nicht. Aus ihnen rechnet `antwortGrund`. */
export function nutzbareWege(
    rueckwege: readonly string[],
    mailweg: boolean,
    adresse: string | null | undefined,
): string[] {
    const mailGeht = mailweg && adresse !== null && adresse !== undefined && istMailAdresse(adresse.trim());
    return rueckwege.filter((weg) => weg !== "mail" || mailGeht);
}

/** Der Knopf „Antworten“: ohne Mailweg „Antworten (Statusseite)“, mit Mail „Antworten“. */
export const antwortKnopfKey = (weg: MailWeg | undefined): MessageKey =>
    weg === "mail"
        ? "community.mails.antwort.sendenMail"
        : weg === "discord"
          ? "community.mails.antwort.sendenDiscord"
          : "community.mails.antwort.senden";

/** Die Zeile über dem Textfeld im Modus Antwort: „An: ‹Adresse›“ bei einer Mail, sonst die Statusseite. */
export const antwortAnText = (weg: MailWeg | undefined, adresse: string | null | undefined): string =>
    weg === "mail" && adresse !== null && adresse !== undefined
        ? t("community.mails.antwort.anMail", { adresse: adresse.trim() })
        : weg === "discord"
          ? t("community.mails.antwort.anDiscord")
          : t(ANTWORT_AN);

/**
 * Warum „Erneut senden“ im Verlauf nicht geht (WI-0291): ohne `answer_community`, im Papierkorb, und ohne Mailweg (der Server lehnt sonst mit 409 ab). `mailweg`: der Stand des Fensters; `false`
 * heißt „nicht eingerichtet“. `undefined`: es geht.
 */
export function erneutSendenGrund(
    rechte: readonly string[],
    papierkorb: boolean,
    mailweg: boolean,
): string | undefined {
    if (!rechte.includes("answer_community")) return t("community.mails.grund.antwortRecht");
    if (papierkorb) return t("community.redaktion.grund.imPapierkorb");
    if (!mailweg) return t("community.redaktion.ablehnung.erneutMailweg");
    return undefined;
}

// --- Zustellstand ausgehender Mails -----------------------------------------------------------------------------------------

/** „wird gesendet …“, „✓ zugestellt“ oder „nicht zugestellt: ‹Grund›“ (Bedienkonzept §3.3, §3.4). */
export function zustellSatz(zustellung: Pick<MailZustellstand, "zustand" | "grund">): string {
    if (zustellung.zustand === "gesendet") return t("community.mails.zustellung.gesendet");
    if (zustellung.zustand === "wartet") return t("community.mails.zustellung.wartet");
    return t("community.mails.zustellung.fehler", { grund: zustellung.grund ?? "" });
}

/** Wartet irgendeine ausgehende Mail noch auf den Versand? Dann fragt das Fenster in kurzen Abständen nach, bis der Zustellstand feststeht. */
export const wartetAufVersand = (
    verlauf: readonly { art: string; zustellung?: { zustand: string } | undefined }[],
): boolean => verlauf.some((eintrag) => eintrag.art === "nachricht" && eintrag.zustellung?.zustand === "wartet");

/** Wie oft und wie lange das Fenster nachfragt, solange eine Mail wartet (Millisekunden): alle vier Sekunden, höchstens zehn Minuten (drei Versuche mit Abstand sind in sechs Minuten durch). */
export const NACHFRAGE_TAKT_MS = 4000;
export const NACHFRAGE_HOECHSTENS_MS = 10 * 60 * 1000;

/** Eine Anfrage, die die Redaktion begonnen hat („von Avesmaps begonnen“) und die noch auf Antwort wartet (Bedienkonzept §3.2). */
export const istBegonnen = (zeile: Pick<VorgangZeile, "eingang" | "zustand">): boolean =>
    zeile.eingang === "redaktion" && zeile.zustand === "rueckfrage";

/** Der Eingang einer Anfrage als Wort; eine selbst begonnene Mail ist „von Avesmaps begonnen“, nicht „Redaktion“ (das meint bei Meldungen etwas anderes). */
export const mailEingangName = (eingang: string): string =>
    eingang === "redaktion" ? t("community.mails.eingang.redaktion") : eingangName(eingang);

// --- „Als Meldung weiterführen“ ---------------------------------------------------------------------------------------------

/** Ein Ort als Bezug der neuen Meldung, aus einem Treffer der Suche. */
export interface OrtWahl {
    readonly id: string;
    readonly name: string;
    readonly typ?: string | undefined;
    readonly lage: CommunityLage;
}

/** Ein Treffer der Suche als Ort; alles andere (Wege, Landschaften, Klimazonen) ist hier kein Bezug. */
export function ortAusTreffer(treffer: SearchHit): OrtWahl | undefined {
    if (treffer.kind !== "ort") return undefined;
    return {
        id: treffer.id,
        name: treffer.name,
        ...(treffer.subtype === undefined ? {} : { typ: treffer.subtype }),
        lage: { x: treffer.x, y: treffer.y },
    };
}

/** Worauf sich die neue Meldung bezieht: ein Ort (Suche) oder eine Stelle auf der Karte (Klick im Lage-Modus). */
export type WeiterfuehrenBezug =
    { readonly art: "ort"; readonly ort: OrtWahl } | { readonly art: "stelle"; readonly lage: CommunityLage };

export interface WeiterfuehrenEntwurf {
    kategorie: MeldungKategorie | "";
    fehltArt: FehltArt | "";
    bezug: WeiterfuehrenBezug | undefined;
    /** Die Beschreibung der Meldung; vorbelegt mit dem Text der Anfrage. */
    text: string;
    quelle: string;
    /** Eine Antwort an den Absender, auf die Statusseite; leer: Die Anfrage ist danach `erledigt`. */
    antwort: string;
}

/** Das Blatt beginnt mit „Sonstiges“ (die Redaktion wählt, was nicht stimmt) und dem Text der Anfrage. */
export const neuerWeiterfuehrenEntwurf = (vorlage: string): WeiterfuehrenEntwurf => ({
    kategorie: "sonstiges",
    fehltArt: "",
    bezug: undefined,
    // Nach Codepunkten gekürzt, damit kein Emoji in der Mitte zerreißt.
    text: [...vorlage].slice(0, COMMUNITY_GRENZEN.textMax).join(""),
    quelle: "",
    antwort: "",
});

/** Warum „Meldung anlegen“ noch nicht geht (Guide §13.19), in der Reihenfolge des Blatts; `undefined`: es geht. */
export function weiterfuehrenSperre(entwurf: WeiterfuehrenEntwurf, rechte: readonly string[]): MessageKey | undefined {
    if (entwurf.kategorie === "") return "community.mails.weiter.sperre.kategorie";
    if (entwurf.kategorie === "fehlt" && entwurf.fehltArt === "") return "community.sperre.fehltArt";
    if (entwurf.bezug === undefined) return "community.mails.weiter.sperre.bezug";
    // WI-0291: Der Server zählt in Codepunkten (ajv); `.length` zählte ein Emoji doppelt.
    const laenge = codepunkte(entwurf.text.trim());
    if (laenge < COMMUNITY_GRENZEN.textMin) return "community.sperre.text";
    if (laenge > COMMUNITY_GRENZEN.textMax) return "community.sperre.textLang";
    if (entwurf.antwort.trim() !== "" && !rechte.includes("answer_community"))
        return "community.mails.grund.antwortRecht";
    return undefined;
}

/**
 * Warum „Meldung anlegen“ noch nicht geht, als fertiger Satz (WI-0291): `weiterfuehrenSperre` mit den Zahlen im Satz (der Schlüssel `community.sperre.textLang` trägt `{max}`; ohne Wert bliebe es
 * wörtlich stehen) und den Grenzen von Quelle (1000) und Antwort (4000), die `weiterfuehrenBody` sonst still abschnitte. `undefined`: es geht.
 */
export function weiterfuehrenSperrSatz(entwurf: WeiterfuehrenEntwurf, rechte: readonly string[]): string | undefined {
    const key = weiterfuehrenSperre(entwurf, rechte);
    if (key === "community.sperre.textLang") return t(key, { max: COMMUNITY_GRENZEN.textMax });
    if (key === "community.sperre.text") return t(key, { min: COMMUNITY_GRENZEN.textMin });
    if (key !== undefined) return t(key);
    return (
        zuLangSatz("quelle", entwurf.quelle, COMMUNITY_GRENZEN.quelleMax) ??
        zuLangSatz("antwort", entwurf.antwort, COMMUNITY_GRENZEN.nachrichtMax)
    );
}

const lageRund = (lage: CommunityLage): CommunityLage => ({
    x: roundMapCoordinate(lage.x),
    y: roundMapCoordinate(lage.y),
});
const gekuerzt = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

/** Der Bezug, wie der Server ihn nimmt (`MeldungBezug`): ein Ort als Objekt mit Schnappschuss, eine Stelle mit ihrer Lage. */
export function weiterfuehrenBezug(bezug: WeiterfuehrenBezug): AlsMeldungBody["bezug"] {
    if (bezug.art === "stelle") return { art: "stelle", lage: lageRund(bezug.lage) };
    return {
        art: "objekt",
        objektArt: "place",
        objektId: bezug.ort.id,
        name: gekuerzt(bezug.ort.name.trim() === "" ? "?" : bezug.ort.name.trim(), 200),
        ...(bezug.ort.typ === undefined || bezug.ort.typ === "" ? {} : { typ: gekuerzt(bezug.ort.typ, 80) }),
        lage: lageRund(bezug.ort.lage),
    };
}

/** Der Rumpf von „Als Meldung weiterführen“ ohne Kennung und Revision. Wirft, wo `weiterfuehrenSperre` etwas meldet: Der Aufrufer prüft zuerst. */
export function weiterfuehrenBody(
    entwurf: WeiterfuehrenEntwurf,
    rechte: readonly string[],
): Omit<AlsMeldungBody, "operationId" | "baseRevision"> {
    if (entwurf.kategorie === "" || entwurf.bezug === undefined || weiterfuehrenSperre(entwurf, rechte) !== undefined)
        throw new Error("Blatt unvollständig");
    const quelle = entwurf.quelle.trim();
    const antwort = entwurf.antwort.trim();
    return {
        kategorie: entwurf.kategorie,
        text: entwurf.text.trim(),
        ...(quelle === "" ? {} : { quelle: gekuerzt(quelle, COMMUNITY_GRENZEN.quelleMax) }),
        ...(entwurf.kategorie === "fehlt" && entwurf.fehltArt !== "" ? { fehltArt: entwurf.fehltArt } : {}),
        bezug: weiterfuehrenBezug(entwurf.bezug),
        ...(antwort === "" ? {} : { antwort: gekuerzt(antwort, COMMUNITY_GRENZEN.nachrichtMax) }),
    };
}

/** Hat jemand im Blatt schon etwas geschrieben oder gewählt, das verloren ginge (Ablage statt Schließen)? */
export const weiterfuehrenHatEntwurf = (entwurf: WeiterfuehrenEntwurf): boolean =>
    entwurf.antwort.trim() !== "" || entwurf.quelle.trim() !== "" || entwurf.bezug !== undefined;

// --- Neue Mail (WI-0268 C6a, Bedienkonzept §3.5) -------------------------------------------------------------------------------

export interface NeueMailEntwurf {
    an: string;
    betreff: string;
    text: string;
}

export const leereNeueMail = (): NeueMailEntwurf => ({ an: "", betreff: "", text: "" });

/** Hat jemand schon etwas geschrieben, das verloren ginge (Ablage statt Schließen)? */
export const neueMailHatEntwurf = (entwurf: NeueMailEntwurf): boolean =>
    entwurf.an.trim() !== "" || entwurf.betreff.trim() !== "" || entwurf.text.trim() !== "";

/**
 * Warum ✚ „Neue Mail“ in der Leiste der Mails gerade nicht aufgeht (Bedienkonzept §3.5: ein Satz, Guide §13.19), in der Reihenfolge, in der der Grund am ehesten zählt: das Recht `send_new_mail`
 * (Betreiber), dann der Mailweg (noch nicht eingerichtet). `undefined`: es geht. Solange der Stand des Mailwegs noch nicht da ist (`undefined`), bleibt der Knopf zu und nennt keinen Grund.
 */
export function neueMailKnopfGrund(rechte: readonly string[], mailweg: boolean | undefined): MessageKey | undefined {
    if (!rechte.includes("send_new_mail")) return "community.mails.neu.grund.recht";
    if (mailweg === false) return "community.mails.neu.grund.mailweg";
    return undefined;
}

/** Ist die Adresse im Feld genau eine gültige? Dasselbe Muster wie auf dem Server. */
export const neueMailAdresseGueltig = (an: string): boolean => istMailAdresse(an.trim());

/** Warum „Senden“ in der Neuen Mail gesperrt ist, in der Reihenfolge des Fensters; `undefined`: es geht. */
export function neueMailSperre(
    entwurf: NeueMailEntwurf,
    rechte: readonly string[],
    mailweg: boolean | undefined,
): MessageKey | undefined {
    const knopf = neueMailKnopfGrund(rechte, mailweg);
    if (knopf !== undefined) return knopf;
    if (entwurf.an.trim() === "") return "community.mails.neu.grund.an";
    if (!neueMailAdresseGueltig(entwurf.an)) return "community.mails.neu.grund.anUngueltig";
    if (entwurf.betreff.trim() === "") return "community.mails.neu.grund.betreff";
    if (entwurf.text.trim() === "") return "community.mails.neu.grund.text";
    return undefined;
}

/**
 * Warum „Senden“ in der Neuen Mail gesperrt ist, als fertiger Satz (WI-0291): `neueMailSperre` und dazu die Grenzen des Servers (Adresse 254, Betreff 150, Text 4000 Zeichen in Codepunkten), damit
 * `neueMailBody` nichts still abschneidet. `undefined`: es geht.
 */
export function neueMailSperrSatz(
    entwurf: NeueMailEntwurf,
    rechte: readonly string[],
    mailweg: boolean | undefined,
): string | undefined {
    const key = neueMailSperre(entwurf, rechte, mailweg);
    if (key !== undefined) return t(key);
    if (codepunkte(entwurf.an.trim()) > COMMUNITY_GRENZEN.mailMax)
        return t("community.redaktion.ablehnung.adresseLang", { max: COMMUNITY_GRENZEN.mailMax });
    return (
        zuLangSatz("betreff", entwurf.betreff.trim().replace(/\s+/gu, " "), COMMUNITY_GRENZEN.betreffNeuMax) ??
        zuLangSatz("text", entwurf.text, COMMUNITY_GRENZEN.nachrichtMax)
    );
}

/** Der Rumpf von `POST /api/community/mails` ohne Kennung. Wirft nicht; der Aufrufer prüft vorher `neueMailSperre`. */
export function neueMailBody(entwurf: NeueMailEntwurf): { an: string; betreff: string; text: string } {
    return {
        an: entwurf.an.trim(),
        betreff: entwurf.betreff.trim().replace(/\s+/gu, " ").slice(0, COMMUNITY_GRENZEN.betreffNeuMax),
        text: entwurf.text.trim().slice(0, COMMUNITY_GRENZEN.nachrichtMax),
    };
}
