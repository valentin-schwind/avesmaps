import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { leseSoc, type VorgangDetail } from "@avesmaps3d/shared";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import { t } from "../i18n/i18n";
import type { LageVorschlag } from "./community-besucher";

/**
 * Die Redaktion der Meldungen als Steuerung der Seite (WI-0268 C3; Bedienkonzept WI-0263 §1.1, §1.3, §2.2): Der Reiter „Community › Meldungen“ und das Vorgangsfenster kennen einander nicht, sie reden
 * über diese eine Steuerung (Muster von `community-besucher.ts`). `app.vue` verbindet sie einmal mit den Fenstern, der Kamera und den Editoren der Seite (`verbinde`) und hängt sonst nur
 * `community-redaktion.vue` ein.
 *
 * - 🔴 **Ein Vorgang ist ein Werkzeugfenster der Fensterverwaltung** (`werkzeug` `vorgang`, `gegenstand` die COM-Nummer): angedockt, gelöst oder abgelegt unter „Offene Bearbeitungen“ - die Hülle und die
 *   Verwaltung tun das, nicht das Modul. Ein Vorgang steht in höchstens einem Fenster (die Verwaltung holt ihn nach vorn, statt ein zweites zu öffnen).
 * - **Ein zweiter Vorgang ersetzt den ersten im selben Fenster** (Bedienkonzept §1.1), mit derselben Lage und Box. Trägt das erste eine Eingabe (`ungespeichert`), geht es nicht verloren: Es wird abgelegt
 *   und steht dann unter „Offene Bearbeitungen“ (`oeffneAnStelle`, Entwurf bleibt).
 * - **Die Karte folgt dem Fenster:** Beim Öffnen fliegt die Kamera zum Bezug (nie ein Sprung, nur über `camera.ts`), und der Geist der vorgeschlagenen Lage steht gestrichelt auf der Karte
 *   (`redaktion-lage.ts`); die Karte ändert sich dabei nie (`map_mutation = false`).
 */

export const VORGANG_WERKZEUG = "vorgang";
/** Das Werkzeug der Fenster einer Bewertung (WI-0269 C10): `gegenstand` ist die öffentliche Kennung der Bewertung. */
export const BEWERTUNG_WERKZEUG = "bewertung";
/** Das Werkzeug der Fenster eines Kartenvorschlags (WI-0275): `gegenstand` ist die öffentliche Kennung des Vorschlags. */
export const KARTENVORSCHLAG_WERKZEUG = "kartenvorschlag";
/** Das Werkzeug der Fenster eines Beitrags im Social Hub (WI-0270 C11): `gegenstand` ist die Nummer des Beitrags, oder `neu` für einen, der noch nicht gespeichert ist. */
export const BEITRAG_WERKZEUG = "beitrag";
/** Der `gegenstand` eines Beitrags, der noch keine Nummer hat. */
export const NEUER_BEITRAG = "neu";
/** Das Werkzeug des Fensters „Neue Mail“ (WI-0268 C6a, Bedienkonzept §3.5): höchstens eins; `gegenstand` ist `NEUE_MAIL`. */
export const NEUE_MAIL_WERKZEUG = "neue-mail";
export const NEUE_MAIL = "neu";

/** Was „Als Beitrag vorschlagen“ dem Fenster „Neuer Beitrag“ mitgibt (Bedienkonzept §6.6): Text und Herkunft; nie Daten des Melders. */
export interface BeitragVorlage {
    readonly text: string;
    /** Die COM-Nummer (ohne Präfix) des Vorgangs. */
    readonly vorgang: number;
    readonly rubrik: string;
}

export type VorgangBezug = NonNullable<VorgangDetail["bezug"]>;
export type BlattWunsch = "verbergen";

/** Was `app.vue` der Redaktion von der Seite gibt: die Fensterverwaltung und die beiden Griffe zur Karte und zum Editor. */
export interface RedaktionNaht {
    readonly fenster: Werkzeugfenster;
    /** Editor › Community › Meldungen nach vorn: das Editorpanel zeigen und den Unterreiter wählen (der Klick in der Glocke, WI-0268 C5). */
    zeigeMeldungen(unterreiter?: string): void;
    /** Den Bezug auf der Karte zeigen: das Objekt wählen und anfliegen, eine Stelle anfliegen. */
    zeige(bezug: VorgangBezug): void;
    /** Das Objekt im Editor seiner Art öffnen (⚙). `vorgang` ist die COM-Nummer: Sie wird die Herkunft jeder Korrektur am Objekt (WI-0268 C7, `herkunft.ts`). */
    oeffneImEditor(
        bezug: VorgangBezug & { objektArt: NonNullable<VorgangBezug["objektArt"]>; objektId: string },
        vorgang: string,
    ): void;
}

export interface Redaktion {
    /** Der Geist der vorgeschlagenen Lage, den die Karte zeichnet (`redaktion-lage.ts`). */
    readonly vorschlag: Readonly<ShallowRef<LageVorschlag | undefined>>;
    /** Zählt hoch, wenn sich an einem Vorgang etwas geändert hat: Die Liste lädt dann neu. */
    readonly listeVersion: Readonly<Ref<number>>;
    /** Die Fenster der Vorgänge, in der Reihenfolge der Verwaltung. */
    readonly vorgangFenster: ComputedRef<WerkzeugFenster[]>;
    /** Die Fenster der Bewertungen (WI-0269 C10), in der Reihenfolge der Verwaltung. */
    readonly bewertungFenster: ComputedRef<WerkzeugFenster[]>;
    /** Die Fenster der Kartenvorschläge (WI-0275), in der Reihenfolge der Verwaltung. */
    readonly kartenvorschlagFenster: ComputedRef<WerkzeugFenster[]>;
    /** Die Fenster der Beiträge des Social Hubs (WI-0270 C11), in der Reihenfolge der Verwaltung. */
    readonly beitragFenster: ComputedRef<WerkzeugFenster[]>;
    /** Das Fenster „Neue Mail“ (WI-0268 C6a): höchstens eins. */
    readonly neueMailFenster: ComputedRef<WerkzeugFenster[]>;
    /** Ist die Seite verbunden (Fenster, Karte, Editoren)? Ohne sie öffnet nichts. */
    readonly verbunden: ComputedRef<boolean>;
    readonly fenster: ComputedRef<Werkzeugfenster | undefined>;
    verbinde(naht: RedaktionNaht): void;
    /** Einen Vorgang öffnen: im vordersten Fenster der Vorgänge, sonst in einem neuen (angedockt, oder wo es zuletzt stand). */
    oeffne(nummer: string, titel: string): string | undefined;
    /**
     * Der Klick in der Glocke (WI-0268 C5): Editor › Community › Meldungen zeigen und, mit Nummer, diesen Vorgang öffnen (sonst bleibt es bei der
     * Liste, die neu lädt; auch ein neuer Kartenvorschlag steht dort, WI-0305). Mit `unterreiter` ein anderer Unterreiter (`mails` bei einer neuen Anfrage, WI-0268 C4). `false`, wenn die Seite keine
     * Redaktion hat (kein Editor).
     */
    oeffneMeldung(nummer: string | null, unterreiter?: string): boolean;
    /** Der Klick in der Glocke auf einen Beitrag (WI-0270 C11): Editor › Community › Social Hub zeigen und, mit SOC-Nummer, diesen Beitrag öffnen. `false`, wenn die Seite keine Redaktion hat. */
    oeffneSocial(nummer: string | null): boolean;
    /**
     * Eine Bewertung öffnen (WI-0269 C10): im vordersten Fenster der Bewertungen, sonst in einem neuen (angedockt, oder wo es zuletzt stand). Mit `blatt` geht das kleine Blatt gleich auf
     * (⊘ „Verbergen …“ in der Liste).
     */
    oeffneBewertung(id: string, titel: string, blatt?: "verbergen"): string | undefined;
    /** Einen Kartenvorschlag öffnen (WI-0275; aus der Liste der Meldungen seit WI-0305), wie eine Bewertung: im vordersten Fenster seiner Art, sonst in einem neuen. */
    oeffneKartenvorschlag(id: string, titel: string): string | undefined;
    /** Der Wunsch nach einem Blatt in einem Fenster der Bewertungen; das Fenster liest ihn nach dem Laden und räumt ihn weg. */
    readonly blattWunsch: Readonly<ShallowRef<{ id: string; blatt: BlattWunsch } | undefined>>;
    nimmBlattWunsch(id: string): BlattWunsch | undefined;
    /**
     * Einen Beitrag öffnen (WI-0270 C11): im vordersten Fenster der Beiträge, sonst in einem neuen (angedockt, oder wo es zuletzt stand). `NEUER_BEITRAG` öffnet das leere Formular, mit `vorlage` das vom Vorgang
     * vorbelegte. Trägt das vorderste Fenster eine Eingabe, wird es abgelegt und geht nicht verloren.
     */
    oeffneBeitrag(gegenstand: string, titel: string, vorlage?: BeitragVorlage): string | undefined;
    /** Die Vorlage eines neuen Beitrags; das Fenster liest sie beim Öffnen und räumt sie weg. */
    nimmBeitragVorlage(): BeitragVorlage | undefined;
    /** Das Fenster eines neuen Beitrags hat ihn gespeichert: Es trägt nun dessen Nummer. */
    beitragAngelegt(fensterId: string, nummer: string, titel: string): void;
    /** Das Fenster „Neue Mail“ öffnen, angedockt wie die übrigen Redaktionsfenster; ist es offen, kommt es nach vorn (ein Entwurf geht nicht verloren). `undefined`, wenn die Seite keine Redaktion hat. */
    oeffneNeueMail(): string | undefined;
    /** Etwas am Vorgang hat sich geändert (oder die Liste soll neu laden). */
    geaendert(): void;
    zeige(bezug: VorgangBezug): void;
    /** ⚙ im Vorgang `vorgang` (COM-Nummer): das Objekt des Bezugs im Editor öffnen, mit dem Vorgang als Herkunft. */
    oeffneImEditor(bezug: VorgangBezug, vorgang: string): void;
    setzeVorschlag(vorschlag: LageVorschlag | undefined): void;
}

/** Der Geist: neue Lage mit der alten dahinter; ohne Vorschlag im Bezug keiner. */
export function vorschlagVon(bezug: VorgangBezug | null | undefined): LageVorschlag | undefined {
    if (bezug === null || bezug === undefined || bezug.vorschlagLage === null) return undefined;
    return { neu: bezug.vorschlagLage, ...(bezug.lage === null ? {} : { alt: bezug.lage }) };
}

export function createRedaktion(): Redaktion {
    const naht = shallowRef<RedaktionNaht | undefined>(undefined);
    const vorschlag = shallowRef<LageVorschlag | undefined>(undefined);
    const listeVersion = ref(0);
    const blattWunsch = shallowRef<{ id: string; blatt: BlattWunsch } | undefined>(undefined);
    let beitragVorlage: BeitragVorlage | undefined;
    const fenster = computed(() => naht.value?.fenster);
    const vorgangFenster = computed(
        () => fenster.value?.stand.value.fenster.filter((eintrag) => eintrag.werkzeug === VORGANG_WERKZEUG) ?? [],
    );

    const oeffne: Redaktion["oeffne"] = (nummer, titel) => {
        const verwaltung = naht.value?.fenster;
        if (verwaltung === undefined) return undefined;
        const wunsch = { werkzeug: VORGANG_WERKZEUG, gegenstand: nummer, titel, nurLesen: false } as const;
        // Das vorderste SICHTBARE Fenster der Vorgänge trägt den neuen (Lage und Box bleiben); sonst entsteht eins, angedockt oder wo es zuletzt stand.
        const sichtbare = vorgangFenster.value
            .filter((eintrag) => eintrag.lage !== "versenkt")
            .sort((a, b) => b.vorn - a.vorn);
        const an = sichtbare[0]?.id;
        return an === undefined
            ? verwaltung.oeffne(wunsch, "angedockt")
            : verwaltung.oeffneAnStelle(an, wunsch, { ohneEntwurfSchliessen: true });
    };
    const bewertungFenster = computed(
        () => fenster.value?.stand.value.fenster.filter((eintrag) => eintrag.werkzeug === BEWERTUNG_WERKZEUG) ?? [],
    );

    const kartenvorschlagFenster = computed(
        () =>
            fenster.value?.stand.value.fenster.filter((eintrag) => eintrag.werkzeug === KARTENVORSCHLAG_WERKZEUG) ?? [],
    );

    const beitragFenster = computed(
        () => fenster.value?.stand.value.fenster.filter((eintrag) => eintrag.werkzeug === BEITRAG_WERKZEUG) ?? [],
    );
    const oeffneBeitrag: Redaktion["oeffneBeitrag"] = (gegenstand, titel, vorlage) => {
        const verwaltung = naht.value?.fenster;
        if (verwaltung === undefined) return undefined;
        beitragVorlage = vorlage;
        const wunsch = { werkzeug: BEITRAG_WERKZEUG, gegenstand, titel, nurLesen: false } as const;
        // Wie bei den Vorgängen: das vorderste SICHTBARE Fenster der Beiträge trägt den neuen (Lage und Box bleiben), sonst entsteht eins.
        const sichtbare = beitragFenster.value
            .filter((eintrag) => eintrag.lage !== "versenkt")
            .sort((a, b) => b.vorn - a.vorn);
        const an = sichtbare[0]?.id;
        return an === undefined
            ? verwaltung.oeffne(wunsch, "angedockt")
            : verwaltung.oeffneAnStelle(an, wunsch, { ohneEntwurfSchliessen: true });
    };

    const neueMailFenster = computed(
        () => fenster.value?.stand.value.fenster.filter((eintrag) => eintrag.werkzeug === NEUE_MAIL_WERKZEUG) ?? [],
    );
    const oeffneNeueMail: Redaktion["oeffneNeueMail"] = () => {
        const verwaltung = naht.value?.fenster;
        if (verwaltung === undefined) return undefined;
        // Dasselbe Werkzeug mit demselben Gegenstand ist dasselbe Fenster: Die Verwaltung holt es nach vorn, statt ein zweites zu öffnen.
        return verwaltung.oeffne(
            {
                werkzeug: NEUE_MAIL_WERKZEUG,
                gegenstand: NEUE_MAIL,
                titel: t("community.mails.neu.titel"),
                nurLesen: false,
            },
            "angedockt",
        );
    };

    return {
        vorschlag,
        listeVersion,
        vorgangFenster,
        bewertungFenster,
        kartenvorschlagFenster,
        beitragFenster,
        neueMailFenster,
        oeffneNeueMail,
        oeffneBeitrag,
        nimmBeitragVorlage() {
            const vorlage = beitragVorlage;
            beitragVorlage = undefined;
            return vorlage;
        },
        beitragAngelegt(fensterId, nummer, titel) {
            naht.value?.fenster.markiere(fensterId, { gegenstand: nummer, titel, ungespeichert: false });
        },
        oeffneSocial(nummer) {
            if (naht.value === undefined) return false;
            naht.value.zeigeMeldungen("social");
            listeVersion.value += 1;
            const id = nummer === null ? undefined : leseSoc(nummer);
            if (id !== undefined && nummer !== null) oeffneBeitrag(String(id), nummer);
            return true;
        },
        blattWunsch,
        nimmBlattWunsch(id) {
            const wunsch = blattWunsch.value;
            if (wunsch === undefined || wunsch.id !== id) return undefined;
            blattWunsch.value = undefined;
            return wunsch.blatt;
        },
        verbunden: computed(() => naht.value !== undefined),
        fenster,
        verbinde(neu) {
            naht.value = neu;
        },
        oeffne,
        oeffneMeldung(nummer, unterreiter) {
            if (naht.value === undefined) return false;
            naht.value.zeigeMeldungen(unterreiter);
            listeVersion.value += 1;
            if (nummer !== null) oeffne(nummer, nummer);
            return true;
        },
        oeffneBewertung(id, titel, blatt) {
            const verwaltung = naht.value?.fenster;
            if (verwaltung === undefined) return undefined;
            blattWunsch.value = blatt === undefined ? undefined : { id, blatt };
            const wunsch = { werkzeug: BEWERTUNG_WERKZEUG, gegenstand: id, titel, nurLesen: false } as const;
            // Wie bei den Vorgängen: das vorderste SICHTBARE Fenster der Bewertungen trägt die neue (Lage und Box bleiben), sonst entsteht eins.
            const sichtbare = bewertungFenster.value
                .filter((eintrag) => eintrag.lage !== "versenkt")
                .sort((a, b) => b.vorn - a.vorn);
            const an = sichtbare[0]?.id;
            return an === undefined
                ? verwaltung.oeffne(wunsch, "angedockt")
                : verwaltung.oeffneAnStelle(an, wunsch, { ohneEntwurfSchliessen: true });
        },
        oeffneKartenvorschlag(id, titel) {
            const verwaltung = naht.value?.fenster;
            if (verwaltung === undefined) return undefined;
            const wunsch = { werkzeug: KARTENVORSCHLAG_WERKZEUG, gegenstand: id, titel, nurLesen: false } as const;
            // Wie bei den Bewertungen: das vorderste SICHTBARE Fenster trägt den neuen (Lage und Box bleiben), sonst entsteht eins. Ein Grund im alten geht nicht verloren: Es wird abgelegt.
            const sichtbare = kartenvorschlagFenster.value
                .filter((eintrag) => eintrag.lage !== "versenkt")
                .sort((a, b) => b.vorn - a.vorn);
            const an = sichtbare[0]?.id;
            return an === undefined
                ? verwaltung.oeffne(wunsch, "angedockt")
                : verwaltung.oeffneAnStelle(an, wunsch, { ohneEntwurfSchliessen: true });
        },
        geaendert() {
            listeVersion.value += 1;
        },
        zeige(bezug) {
            naht.value?.zeige(bezug);
        },
        oeffneImEditor(bezug, vorgang) {
            if (bezug.objektArt !== null && bezug.objektId !== null) {
                naht.value?.oeffneImEditor({ ...bezug, objektArt: bezug.objektArt, objektId: bezug.objektId }, vorgang);
            }
        },
        setzeVorschlag(neu) {
            vorschlag.value = neu;
        },
    };
}

/** Die eine Steuerung der Seite. */
export const redaktion: Redaktion = createRedaktion();
