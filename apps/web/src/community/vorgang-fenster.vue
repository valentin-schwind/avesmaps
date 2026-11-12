<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import {
    ABSCHLUSS_ERGEBNISSE,
    AVENTURIA,
    COMMUNITY_GRENZEN,
    COMMUNITY_PRIORITAETEN,
    comNummer,
    distanceInMiles,
    leseCom,
    type AbschliessenBody,
    type CommunityPerson,
    type CommunityPrioritaet,
    type VorgangDetail,
} from "@avesmaps3d/shared";
import { openAuthWindow } from "../auth/auth-windows";
import { authState } from "../auth/session-state";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { MessageKey } from "../i18n/de";
import { sonderrollenName } from "../auth/bezeichnung";
import { formatNumber, isMessageKey, t } from "../i18n/i18n";
import { oeffneReisebilder } from "../medien/medien-oeffnen";
import {
    ergebnisName,
    handgriffe,
    kategorieName,
    kreisVon,
    lageVon,
    neuerAbschluss,
    personenName,
    prioritaetName,
    prioritaetPille,
    stehtOffen,
    titelVon,
    verlaufZeilen,
    zeitAbstand,
    zustaendigName,
    zustaendigWahlen,
    zustaendigZeilen,
    ZUSTAND_NAME,
    type AbschlussEntwurf,
} from "./meldungen-modell";
import { ladeMailweg } from "./api";
import {
    MAIL_ZUSTAND_NAME,
    NACHFRAGE_HOECHSTENS_MS,
    NACHFRAGE_TAKT_MS,
    anfrageGriffe,
    antwortGrund,
    antwortWeg,
    erneutSendenGrund,
    nutzbareWege,
    wartetAufVersand,
} from "./mails-modell";
import { istMailwegAus, redaktionGrund, redaktionSatz, zuLangSatz, type FeldGrenzen } from "./redaktion-ablehnung";
import {
    REDAKTION_FEHLER_SATZ,
    antworteAnfrage,
    archivieren,
    fuehreAlsMeldungWeiter,
    insArchiv,
    ladePersonen,
    ladeVorgang,
    loeschePersonenbezug,
    oeffneWieder,
    papierkorb,
    redaktionFehler,
    reicheAnKanalWeiter,
    schliesseAb,
    schreibeNotiz,
    sendeErneut,
    sendeRueckfrage,
    setzePrioritaet,
    setzeRollen,
    setzeZustaendig,
    sichten,
    uebernehmen,
    verknuepfeKorrektur,
    wiederherstellen,
    zurueckInEingang,
} from "./redaktion-api";
import { grundName } from "./bewertungen-modell";
import { NEUER_BEITRAG, redaktion, vorschlagVon } from "./redaktion";
import { vorlageAusVorgang } from "./social-vorlage";
import { KANAL_NACHRICHT_MAX } from "./verknuepfen-modell";
import VorgangAbsender from "./vorgang-absender.vue";
import VorgangAntwort from "./vorgang-antwort.vue";
import VorgangBlatt from "./vorgang-blatt.vue";
import VorgangKanalBlatt from "./vorgang-kanal-blatt.vue";
import VorgangKorrekturBlatt from "./vorgang-korrektur-blatt.vue";
import VorgangMenue, { type MenueEintrag } from "./vorgang-menue.vue";
import VorgangRollenBlatt from "./vorgang-rollen-blatt.vue";
import VorgangVerknuepfungen from "./vorgang-verknuepfungen.vue";
import VorgangVerlauf from "./vorgang-verlauf.vue";
import VorgangWeiterfuehren from "./vorgang-weiterfuehren.vue";

/**
 * Das Fenster EINES Vorgangs der Redaktion (WI-0268 C3; Bedienkonzept WI-0263 §2.2 Nr. 4, §2.3, §2.5, §2.6, §1.3). Ein Werkzeugfenster der Hülle und der Fensterverwaltung (`werkzeug` `vorgang`): angedockt links
 * neben dem Panel, ⧉ lösen, ▥ andocken, − ablegen unter „Offene Bearbeitungen“; so bleibt die Liste stehen und die Karte daneben sichtbar. Ein zweiter Vorgang ersetzt den ersten im selben Fenster
 * (`redaktion.ts`), dann kommt dieses Bauteil mit neuer `gegenstand` und lädt neu.
 *
 * - **Kopf:** „COM-000123 · Lage falsch“. **Leiste:** Stand (Kreis, Zustand), Priorität und Zuständig als Menü, dann die Handgriffe: Übernehmen und Sichten, Abschließen …, das Menü ⋯.
 * - **Rumpf:** der Bezug (mit ⊕ zeigen und ⚙ im Editor öffnen; ein Lagevorschlag steht gestrichelt auf der Karte, nur zum Ansehen), der Melder, der Verlauf in Zeitfolge. Ein kleines Blatt (Abschließen,
 *   Wiedereröffnen, Personenbezug löschen) steht am Anfang des Rumpfs.
 * - **Fuß:** die Eingabe, Notiz | An Melder, Vorgabe **Notiz**, damit nichts aus Versehen nach außen geht.
 * - **Anfragen** (WI-0268 C4, Reiter Mails): Dasselbe Fenster zeigt auch eine Anfrage aus dem Kontaktformular, mit Absender statt Melder (`vorgang-absender.vue`), dem Fuß **Notiz | Antwort**
 *   (`vorgang-antwort.vue`), ↧ Ins Archiv bzw. ↺ Zurück in den Eingang statt „Abschließen …“ und dem Menüeintrag „Als Meldung weiterführen“ (`vorgang-weiterfuehren.vue`). Das Fenster öffnet nur mit
 *   `read_mailbox`; der Server weist es sonst ab, und die Liste zeigt keine Anfrage.
 * - **Mailweg** (WI-0268 C6a): Ist er an (`GET /api/community/stand`) und hat der Absender eine einzelne gültige Adresse, geht die Antwort als Mail („An: ‹Adresse›“, Knopf „Antworten“); sonst auf die Statusseite
 *   („Antworten (Statusseite)“). Im Verlauf trägt jede ausgehende Mail ihren Zustellstand; solange eine wartet, fragt das Fenster alle vier Sekunden nach. „Erneut senden“ erscheint bei „nicht zugestellt“.
 * - **Verknüpfungen** (WI-0268 C7, Fachkonzept §6 und §7): Die Kästen **Korrektur** und **Betreiber-Kanal** (`vorgang-verknuepfungen.vue`) zeigen, was zum Vorgang gehört; das Menü ⋯ öffnet die Blätter „Korrektur
 *   verknüpfen“ (`vorgang-korrektur-blatt.vue`) und, nur mit `use_operator_channel`, „An den Betreiber-Kanal weiterreichen“ (`vorgang-kanal-blatt.vue`). ⚙ gibt dem Editor den Vorgang als Herkunft mit.
 * - 🔴 **Gleichzeitig arbeiten** (Fachkonzept §4.5): Jeder Schritt trägt die Revision, die diese Seite sah. Ein anderer Stand ist `community_conflict`: Das Fenster sagt „Inzwischen geändert“, lädt neu, und die
 *   Eingabe bleibt stehen; nichts wird still überschrieben.
 * - 🔴 **Gesperrt heißt: ein Satz.** Was in diesem Zustand oder mit diesem Recht nicht geht, steht gesperrt da, mit dem Grund (`meldungen-modell.ts`).
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    /** Der Eintrag der Fensterverwaltung: `gegenstand` ist die COM-Nummer. */
    fenster: WerkzeugFenster;
    /** Die Rechte der Sitzung (`moderate_community`, `edit_map_objects` …). */
    rechte: readonly string[];
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
    /** Der Hinflug der Ablage (die Zeile unter „Offene Bearbeitungen“). */
    ablageZiel?: (() => DOMRect | undefined) | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();

// --- Laden -----------------------------------------------------------------------------------------------------------------

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "fehler"; readonly satz: string }
    | { readonly art: "da"; readonly detail: VorgangDetail };

const nummer = computed(() => props.fenster.gegenstand ?? "");
const stand = shallowRef<Stand>({ art: "laedt" });
const detail = computed(() => (stand.value.art === "da" ? stand.value.detail : undefined));
const personen = ref<CommunityPerson[]>([]);
const ich = computed(() => authState.value.person?.id);
const sichtbar = computed(() => props.lage !== "versenkt");
/** Ist der Mailweg eingerichtet (WI-0268 C6a)? `false`, bis die Antwort des Servers da ist: Bis dahin geht die Antwort auf die Statusseite. */
const mailweg = ref(false);
/** Liest den Mailweg neu: beim Öffnen und nach einem 409 „Mailweg nicht eingerichtet“ (WI-0291), damit „Antworten“ und „Erneut senden“ nicht weiter angeboten werden, was nicht geht. */
const leseMailweg = (): void => {
    void ladeMailweg().then((an) => {
        mailweg.value = an;
    });
};
onMounted(leseMailweg);
const archiviert = computed(() => detail.value !== undefined && detail.value.archiviertAt !== null);
const imPapierkorb = computed(() => detail.value !== undefined && detail.value.papierkorbAt !== null);

/** Eine Meldung über dem Rumpf: der Satz der Oberfläche und sein Ton; der Konflikt ist eine Warnung, kein Fehler. */
const meldung = shallowRef<{ readonly satz: string; readonly ton: "warnung" | "gefahr" } | undefined>(undefined);
let lauf = 0;

/** Lädt den Vorgang neu. `fliegen`: Beim ersten Laden fliegt die Karte zum Bezug (Bedienkonzept §2.2 Nr. 3), danach nur auf ⊕. */
async function lade(fliegen = false): Promise<boolean> {
    const mein = ++lauf;
    const zu = nummer.value;
    if (zu === "") return false;
    try {
        const antwort = await ladeVorgang(zu);
        if (mein !== lauf || zu !== nummer.value) return false;
        stand.value = { art: "da", detail: antwort };
        if (fliegen && sichtbar.value && antwort.bezug !== null) redaktion.zeige(antwort.bezug);
        return true;
    } catch (fehler) {
        if (mein !== lauf) return false;
        // Ein veralteter Stand bleibt stehen (nichts verschwindet, nur weil das Netz fehlt); ohne ihn steht der Fehler da.
        const satz = redaktionSatz(fehler);
        if (stand.value.art !== "da") stand.value = { art: "fehler", satz };
        else meldung.value = { satz, ton: "gefahr" };
        return false;
    }
}

/** Wer zuständig sein kann: bei einer Anfrage nur, wer Anfragen lesen darf. */
async function ladeLeute(mails: boolean): Promise<void> {
    try {
        personen.value = await ladePersonen(mails);
    } catch {
        // Ohne die Liste fehlen im Menü „Zuständig“ die anderen; die eigene Zuständigkeit geht trotzdem.
    }
}

const kopfTitel = computed(() => {
    const zeile = detail.value?.zeile;
    return zeile === undefined ? props.fenster.titel : `${zeile.nummer} · ${kategorieName(zeile.kategorie)}`;
});
watch(
    kopfTitel,
    (titel) => {
        if (titel !== props.fenster.titel) redaktion.fenster.value?.markiere(props.fenster.id, { titel });
    },
    { immediate: true },
);

// --- Eingabe, Blatt und Entwurf --------------------------------------------------------------------------------------------

type Blatt = "abschliessen" | "wiedereroeffnen" | "loeschen" | "weiterfuehren" | "korrektur" | "kanal" | "rollen";
/** `notiz` oder `aussen` (An Melder); der Schalter trägt Zeichenketten. */
const modus = ref<string>("notiz");
const text = ref("");
const blatt = shallowRef<Blatt | undefined>(undefined);
const grund = ref("");
const abschluss = ref<AbschlussEntwurf>(neuerAbschluss("meldung", ABSCHLUSS_ERGEBNISSE.meldung, []));
const sendet = ref(false);
/** Hat jemand im Blatt „Als Meldung weiterführen“ schon etwas geschrieben oder gewählt? Das Blatt meldet es. */
const weiterEntwurf = ref(false);
/** Dasselbe für das Blatt „An den Betreiber-Kanal weiterreichen“ (Titel oder Nachricht geändert). */
const kanalEntwurf = ref(false);
/** Dasselbe für das Blatt „Sonderrollen zuweisen“ (die Wahl weicht von den gesetzten Rollen ab). */
const rollenEntwurf = ref(false);
/** Die OPS-Nummer, unter der der Vorgang eben weitergereicht wurde: Das Blatt zeigt dann den Satz „Weitergereicht als …“ statt des Formulars. */
const kanalGesendet = ref<string | undefined>(undefined);
const blattFehler = shallowRef<MessageKey | undefined>(undefined);
/** Der genaue Grund des Servers zum Fehler im Blatt (WI-0291); `blattFehler` bleibt der allgemeine Satz, falls der Server keinen nannte. */
const blattGrund = shallowRef<string | undefined>(undefined);
const eingabe = useTemplateRef<HTMLElement>("eingabe");
const sperrId = useId();
const quelleId = useId();
const editorId = useId();

/** Alles, was jemand geschrieben, aber noch nicht abgeschickt hat: Es geht nie verloren (Ablage statt Schließen, `fenster-verwaltung.ts`). */
const hatEntwurf = computed(
    () =>
        text.value.trim() !== "" ||
        (blatt.value === "abschliessen" && abschluss.value.begruendung.trim() !== "") ||
        (blatt.value === "wiedereroeffnen" && grund.value.trim() !== "") ||
        (blatt.value === "weiterfuehren" && weiterEntwurf.value) ||
        (blatt.value === "kanal" && kanalEntwurf.value) ||
        (blatt.value === "rollen" && rollenEntwurf.value),
);
watch(
    hatEntwurf,
    (ja) => {
        if (ja !== props.fenster.ungespeichert)
            redaktion.fenster.value?.markiere(props.fenster.id, { ungespeichert: ja });
    },
    { immediate: true },
);

function zuruecksetzen(): void {
    lauf += 1;
    stand.value = { art: "laedt" };
    meldung.value = undefined;
    modus.value = "notiz";
    text.value = "";
    blatt.value = undefined;
    grund.value = "";
    blattFehler.value = undefined;
    blattGrund.value = undefined;
    sendet.value = false;
    weiterEntwurf.value = false;
    kanalEntwurf.value = false;
    rollenEntwurf.value = false;
    kanalGesendet.value = undefined;
    abschluss.value = neuerAbschluss("meldung", ABSCHLUSS_ERGEBNISSE.meldung, []);
}

// Ein anderer Vorgang im selben Fenster (Bedienkonzept §1.1): Zustand weg, neu laden. Die Eingabe des alten steht dann unter „Offene Bearbeitungen“ (`oeffneAnStelle`).
watch(
    nummer,
    () => {
        zuruecksetzen();
        void lade(true);
    },
    { immediate: true },
);
// Die Personen kommen, sobald die Art des Vorgangs feststeht: Eine Anfrage kann nur an jemanden gehen, der sie lesen darf.
watch(
    () => detail.value?.zeile.art,
    (art) => {
        if (art !== undefined) void ladeLeute(art === "anfrage");
    },
    { immediate: true },
);

// --- Was geht, und warum nicht ---------------------------------------------------------------------------------------------

const lageDaten = computed(() => (detail.value === undefined ? undefined : lageVon(detail.value)));
const griffe = computed(() =>
    lageDaten.value === undefined ? undefined : handgriffe(lageDaten.value, props.rechte, ich.value),
);
const zeile = computed(() => detail.value?.zeile);
const istAnfrage = computed(() => zeile.value?.art === "anfrage");
/** Die Handgriffe, die nur Anfragen haben: ↧ Ins Archiv, ↺ Zurück in den Eingang, „Als Meldung weiterführen“. */
const anfrageStand = computed(() => (lageDaten.value === undefined ? undefined : anfrageGriffe(lageDaten.value)));
/** Die Adresse des Absenders (nur mit `read_mailbox`, das Fenster einer Anfrage verlangt es ohnehin). */
const absenderAdresse = computed(() => detail.value?.melder.mail ?? null);
/** Die Wege, über die eine Antwort wirklich hinausgeht: `mail` zählt nur mit Mailweg und einer einzelnen gültigen Adresse. */
const antwortWege = computed(() =>
    nutzbareWege(detail.value?.melder.rueckwege ?? [], mailweg.value, absenderAdresse.value),
);
/** Wohin die Antwort geht: Mail oder Statusseite. */
const wegAntwort = computed(() =>
    antwortWeg(detail.value?.melder.rueckwege ?? [], mailweg.value, absenderAdresse.value),
);
/** Warum eine Antwort gerade nicht geht (oder `undefined`): Recht, Papierkorb, Archiv, Rückweg. */
const antwortStandGrund = computed(() =>
    !istAnfrage.value || lageDaten.value === undefined
        ? undefined
        : antwortGrund({ ...lageDaten.value, rueckwege: antwortWege.value }, props.rechte),
);
/** Warum „Erneut senden“ im Verlauf nicht geht: ohne `answer_community`, im Papierkorb, oder ohne Mailweg (der Server lehnt sonst mit 409 ab). */
const erneutGrund = computed(() => erneutSendenGrund(props.rechte, imPapierkorb.value, mailweg.value));
const erneutLaeuft = ref<number | undefined>(undefined);
const offenBearbeitbar = computed(() => lageDaten.value !== undefined && stehtOffen(lageDaten.value));
const rueckwege = computed(() => detail.value?.melder.rueckwege ?? []);
/** Der Weg nach außen: heute die Statusseite (Mail und Discord folgen mit dem Mailweg, C6). */
/** Ein Melder nur aus Discord (WI-0297): kein Statuslink, keine Adresse; er liest Rückfrage und Abschlussnachricht mit `/offen`. */
const nurDiscord = computed(
    () =>
        rueckwege.value.includes("discord") &&
        !rueckwege.value.includes("statusseite") &&
        !rueckwege.value.includes("mail"),
);
const wegText = computed(() =>
    nurDiscord.value
        ? t("community.redaktion.weg.discord")
        : rueckwege.value.length > 0
          ? t("community.redaktion.weg.statusseite")
          : "",
);
const anMelderGrund = computed(() => {
    const key = griffe.value?.anMelder.grund;
    return key === undefined ? undefined : t(key);
});
const standText = computed(() => {
    const z = zeile.value;
    if (z === undefined) return "";
    if (z.zustand === "abgeschlossen")
        return t("community.redaktion.standAbgeschlossen", { ergebnis: ergebnisName(z.ergebnis) });
    // Bei einer Anfrage heißt die Rückfrage „wartet auf Antwort“ (Bedienkonzept §3.2).
    return t((z.art === "anfrage" ? MAIL_ZUSTAND_NAME : ZUSTAND_NAME)[z.zustand]);
});
/** „zuständig: Vali“ oder „zuständig: niemand“ (die Liste sagt „niemand zuständig“, hier steht das Wort schon davor). */
const zustaendigAnzeige = computed(() =>
    zeile.value === undefined || zeile.value.zustaendig === null
        ? t("community.redaktion.filter.zustaendig.niemand")
        : zustaendigName(zeile.value),
);
const eingangText = computed(() => {
    const z = zeile.value;
    if (z === undefined) return "";
    const key = `community.redaktion.eingang.${z.eingang}`;
    return t("community.redaktion.eingangVor", {
        eingang: isMessageKey(key) ? t(key) : z.eingang,
        zeit: zeitAbstand(z.eingegangenAt),
    });
});
const verlauf = computed(() =>
    detail.value === undefined
        ? []
        : verlaufZeilen(detail.value.verlauf, personenName(personen.value), detail.value.zeile.art),
);
/** Die erste Nachricht des Absenders: der Text, mit dem „Als Meldung weiterführen“ beginnt. */
const ersteNachricht = computed(
    () =>
        detail.value?.verlauf.find((eintrag) => eintrag.art === "nachricht" && eintrag.richtung === "ein")?.text ?? "",
);

const prioritaetEintraege = computed((): MenueEintrag[] =>
    COMMUNITY_PRIORITAETEN.map((p) => ({ id: p, text: prioritaetName(p), aktiv: zeile.value?.prioritaet === p })),
);

const KEINER = "-";
/** Wer an der Stelle der Meldung Ortskundiger oder Regionalkanzler ist (WI-0279 E3c): Hinweis im Bezug, im Menü „Zuständig“ oben. */
const regionPersonen = computed(
    () => new Set((detail.value?.regionen ?? []).flatMap((region) => region.personen.map((zeile) => zeile.person.id))),
);
const regionZeilen = computed((): string[] => {
    const regionen = detail.value?.regionen ?? [];
    const besetzt = regionen.filter((region) => region.personen.length > 0);
    if (besetzt.length === 0) {
        if (regionen.length === 0) return [];
        return [
            t("community.redaktion.region.niemand", { regionen: regionen.map((region) => region.name).join(", ") }),
        ];
    }
    return besetzt.map((region) =>
        t("community.redaktion.region.personen", {
            region: region.name,
            personen: region.personen
                .map((zeile) =>
                    t("community.redaktion.region.person", {
                        rolle: sonderrollenName(zeile.sonderrolle, zeile.bezeichnung),
                        name: zeile.person.name,
                    }),
                )
                .join(" · "),
        }),
    );
});
const zustaendigEintraege = computed((): MenueEintrag[] => {
    const z = zeile.value;
    if (z === undefined) return [];
    return zustaendigWahlen(personen.value, z.zustaendig, ich.value, regionPersonen.value).map((wahl) => ({
        id: wahl.person?.id ?? KEINER,
        text:
            wahl.person === null
                ? t("community.redaktion.filter.zustaendig.niemand")
                : wahl.person.id === ich.value
                  ? t("community.redaktion.mir", { name: wahl.person.name })
                  : wahl.person.name,
        aktiv: wahl.aktiv,
    }));
});

/** Kasten „Zuständig“ über dem Bezug (WI-0279): die Person und je Rolle eine Zeile; ohne jede Zuweisung fehlt er. */
const zustaendigKasten = computed(() =>
    detail.value === undefined || istAnfrage.value ? [] : zustaendigZeilen(detail.value, ich.value),
);

/** Das Menü „⋯“: Wiedereröffnen und Ins Archiv, dann die Moderation (nur mit `moderate_community`, sonst gesperrt mit Grund). */
const mehrEintraege = computed((): MenueEintrag[] => {
    const g = griffe.value;
    if (g === undefined) return [];
    const mit = (
        id: string,
        textKey: MessageKey,
        stand_: { zeigen: boolean; grund?: MessageKey | undefined },
        extra: Partial<MenueEintrag> = {},
    ): MenueEintrag[] =>
        stand_.zeigen
            ? [{ id, text: t(textKey), gesperrt: stand_.grund === undefined ? undefined : t(stand_.grund), ...extra }]
            : [];
    // Eine Anfrage hat kein Wiedereröffnen mit Grund und kein Archivieren im Menü: ↧ und ↺ stehen in der Leiste; dafür „Als Meldung weiterführen“ (Bedienkonzept §3.3).
    // „Sonderrollen zuweisen …“ (WI-0279): an einer offenen Meldung zuoberst, mit der Zahl der gesetzten Rollen, wenn es welche gibt.
    const gesetzt = detail.value?.rollen?.length ?? 0;
    const rollen: MenueEintrag[] =
        istAnfrage.value || !offenBearbeitbar.value || detail.value?.rollenInhaber === undefined
            ? []
            : [
                  {
                      id: "rollen",
                      text:
                          gesetzt === 0
                              ? t("community.redaktion.mehr.rollen")
                              : t("community.redaktion.mehr.rollenAendern", { n: formatNumber(gesetzt, 0) }),
                  },
              ];
    const alltag = istAnfrage.value
        ? mit("als-meldung", "community.mails.mehr.alsMeldung", anfrageStand.value?.alsMeldung ?? { zeigen: false })
        : [
              ...mit("wiedereroeffnen", "community.redaktion.mehr.wiedereroeffnen", g.wiedereroeffnen),
              ...mit("archivieren", "community.redaktion.mehr.archivieren", g.archivieren),
          ];
    // „Als Beitrag vorschlagen“ (WI-0270 C11, Bedienkonzept §6.6): ein Entwurf im Social Hub mit Herkunft COM-… ohne Melderdaten; braucht das Recht für Beiträge des Projekts.
    const beitrag: MenueEintrag[] = [
        {
            id: "beitrag",
            text: t("community.social.vorgang.vorschlagen"),
            gesperrt: props.rechte.includes("social_communication")
                ? undefined
                : t("community.social.vorgang.keinRecht"),
        },
    ];
    // „Korrektur verknüpfen“ und „An den Betreiber-Kanal weiterreichen“ (WI-0268 C7): nicht an einem Vorgang im Papierkorb; der Kanal nur für die, die ihn benutzen dürfen (sonst steht der Eintrag nicht da).
    const verknuepfen: MenueEintrag[] = imPapierkorb.value
        ? []
        : [
              { id: "korrektur", text: t("community.verknuepfen.mehr.korrektur") },
              ...(props.rechte.includes("use_operator_channel")
                  ? [{ id: "kanal", text: t("community.verknuepfen.mehr.kanal") }]
                  : []),
          ];
    const moderation = [
        ...mit("papierkorb", "community.redaktion.mehr.papierkorb", g.papierkorb, { gefahr: true }),
        ...mit("wiederherstellen", "community.redaktion.mehr.wiederherstellen", g.wiederherstellen),
        ...mit("personenbezug", "community.redaktion.mehr.personenbezug", g.personenbezug, { gefahr: true }),
    ];
    if (alltag.length > 0 && moderation.length > 0) moderation[0] = { ...moderation[0]!, trenner: true };
    const rest = [...alltag, ...verknuepfen, ...beitrag, ...moderation];
    if (rollen.length > 0 && rest.length > 0) rest[0] = { ...rest[0]!, trenner: true };
    return [...rollen, ...rest];
});

// --- Schritte --------------------------------------------------------------------------------------------------------------

/**
 * Führt einen Schritt aus und lädt danach neu. Ein veralteter Stand (`community_conflict`) oder ein Übergang, der nicht mehr geht, laden den Vorgang neu und sagen es; die Eingabe bleibt in beiden Fällen
 * stehen. `true`, wenn der Schritt gelungen ist.
 */
async function tue(schritt: () => Promise<unknown>): Promise<boolean> {
    if (sendet.value) return false;
    sendet.value = true;
    meldung.value = undefined;
    blattFehler.value = undefined;
    blattGrund.value = undefined;
    try {
        await schritt();
    } catch (fehler) {
        const art = redaktionFehler(fehler);
        const grenzen = blattGrenzen();
        if (istMailwegAus(fehler)) leseMailweg();
        if (art === "konflikt" || art === "uebergang") {
            // „Inzwischen geändert“: neu laden, die Eingabe bleibt; nie still überschreiben. Der Satz sagt den genauen Grund und dass neu geladen ist.
            meldung.value = { satz: redaktionSatz(fehler, grenzen, art), ton: "warnung" };
            await lade();
            redaktion.geaendert();
        } else if (blatt.value === undefined)
            meldung.value = { satz: redaktionSatz(fehler, grenzen, art), ton: "gefahr" };
        else {
            // Der genaue Grund geht vor; ohne ihn bleibt der allgemeine Satz zur Fehlerart (die Blätter Korrektur und Kanal deuten ihn nach ihrem Sinn um).
            blattFehler.value = REDAKTION_FEHLER_SATZ[art];
            blattGrund.value = redaktionGrund(fehler, grenzen);
        }
        sendet.value = false;
        return false;
    }
    await lade();
    redaktion.geaendert();
    sendet.value = false;
    return true;
}

/** Die Grenzen, die im offenen Blatt gelten: „Als Meldung weiterführen“ nimmt 10 bis 2000 Zeichen Text, der Kanal bis 8000 Zeichen Nachricht. */
const blattGrenzen = (): FeldGrenzen =>
    blatt.value === "weiterfuehren"
        ? { textMax: COMMUNITY_GRENZEN.textMax }
        : blatt.value === "kanal"
          ? { nachrichtMax: KANAL_NACHRICHT_MAX }
          : {};

const revision = (): number => zeile.value?.revision ?? 1;

/** Die gemeldete Bewertung im Reiter Bewertungen öffnen (WI-0269 C10). */
const oeffneBewertung = (bewertung: string | null | undefined): void => {
    if (bewertung === null || bewertung === undefined) return;
    redaktion.oeffneBewertung(
        bewertung,
        `${t("bewertungen.redaktion.vorgang.titel")} ${bezug.value?.name ?? ""}`.trim(),
    );
};

const uebernimm = (): Promise<boolean> => tue(() => uebernehmen(nummer.value, revision()));
const sichte = (): Promise<boolean> => tue(() => sichten(nummer.value, revision()));
const waehlePrioritaet = (id: string): Promise<boolean> =>
    tue(() => setzePrioritaet(nummer.value, revision(), id as CommunityPrioritaet));
const waehleZustaendig = (id: string): Promise<boolean> =>
    tue(() => setzeZustaendig(nummer.value, revision(), id === KEINER ? null : id));

async function schreibe(): Promise<void> {
    const geschrieben = text.value.trim();
    if (geschrieben === "") return;
    const aussen = modus.value === "aussen";
    const ok = await tue(() =>
        aussen ? sendeRueckfrage(nummer.value, revision(), geschrieben) : schreibeNotiz(nummer.value, geschrieben),
    );
    if (ok) {
        text.value = "";
        // Vorgabe ist Notiz, damit nichts aus Versehen nach außen geht.
        modus.value = "notiz";
    }
}

/** Eine Notiz im Fuß einer Anfrage (der Modus Notiz). */
async function schreibeAnfrageNotiz(): Promise<void> {
    const geschrieben = text.value.trim();
    if (geschrieben === "") return;
    if (await tue(() => schreibeNotiz(nummer.value, geschrieben))) text.value = "";
}

/**
 * Antworten, als Mail oder auf die Statusseite (`wegAntwort`); mit `archivieren` kommt die Anfrage ins Archiv, bei einer Mail erst nach der Annahme durch den Mailserver. Danach beginnt der Fuß wieder bei der Notiz.
 * Der Weg geht ausdrücklich mit: Der Server wählt sonst nach seinem Mailweg, und beide sollen dasselbe meinen.
 */
async function antworte(archivieren: boolean): Promise<void> {
    const geschrieben = text.value.trim();
    const weg = wegAntwort.value;
    if (geschrieben === "" || antwortStandGrund.value !== undefined || weg === undefined) return;
    if (await tue(() => antworteAnfrage(nummer.value, revision(), geschrieben, archivieren, weg))) {
        text.value = "";
        modus.value = "notiz";
    }
}

/** „Erneut senden“ bei einer nicht zugestellten Mail: ein Klick, dann lädt das Fenster neu und zeigt „wird gesendet …“. */
async function erneutSenden(nachricht: number): Promise<void> {
    if (erneutLaeuft.value !== undefined) return;
    erneutLaeuft.value = nachricht;
    try {
        await tue(() => sendeErneut(nummer.value, nachricht));
    } finally {
        erneutLaeuft.value = undefined;
    }
}

// Solange eine ausgehende Mail wartet, fragt das Fenster in kurzen Abständen nach, bis der Zustellstand feststeht (höchstens zehn Minuten). Ein Fenster, das niemand sieht, fragt nicht.
let nachfrage: ReturnType<typeof setInterval> | undefined;
let nachfrageSeit = 0;
function stoppeNachfrage(): void {
    if (nachfrage !== undefined) clearInterval(nachfrage);
    nachfrage = undefined;
}
watch(
    () => detail.value !== undefined && wartetAufVersand(detail.value.verlauf),
    (wartet) => {
        stoppeNachfrage();
        if (!wartet) return;
        nachfrageSeit = Date.now();
        nachfrage = setInterval(() => {
            if (Date.now() - nachfrageSeit > NACHFRAGE_HOECHSTENS_MS) {
                stoppeNachfrage();
                return;
            }
            if (sichtbar.value && !sendet.value) void lade().then(() => redaktion.geaendert());
        }, NACHFRAGE_TAKT_MS);
    },
    { immediate: true },
);
onBeforeUnmount(stoppeNachfrage);

const insArchivLegen = (): Promise<boolean> => tue(() => insArchiv(nummer.value, revision()));
const zurueckHolen = (): Promise<boolean> => tue(() => zurueckInEingang(nummer.value, revision()));
// Ist die Antwort während des Schreibens gesperrt worden (Archiv, Papierkorb), steht der Fuß wieder bei der Notiz.
watch(antwortStandGrund, (grundNeu) => {
    if (grundNeu !== undefined && modus.value === "antwort") modus.value = "notiz";
});

/** „Meldung anlegen“ im Blatt: die Meldung entsteht, die Anfrage kommt ins Archiv, und die neue Meldung öffnet (im selben Fenster, wie jeder zweite Vorgang). */
async function fuehreWeiter(body: Parameters<typeof fuehreAlsMeldungWeiter>[2]): Promise<void> {
    const ergebnis: { neu?: string } = {};
    const ok = await tue(async () => {
        ergebnis.neu = (await fuehreAlsMeldungWeiter(nummer.value, revision(), body)).meldung;
    });
    if (!ok || ergebnis.neu === undefined) return;
    schliesseBlatt();
    redaktion.oeffne(ergebnis.neu, ergebnis.neu);
}

/** Ein anderer Vorgang aus dem Absender oder den Verknüpfungen: im selben Fenster, wie jeder zweite Vorgang. */
const oeffneAnderen = (nummerNeu: string): void => {
    redaktion.oeffne(nummerNeu, nummerNeu);
};

const sendeText = computed(() =>
    modus.value === "aussen"
        ? t("community.redaktion.eingabe.rueckfrageSenden", { weg: t("community.redaktion.weg.nurStatusseite") })
        : t("community.redaktion.eingabe.notizSpeichern"),
);
const sendeSperre = computed((): string | undefined => {
    if (sendet.value) return "";
    if (text.value.trim() === "") return t("community.redaktion.grund.textFehlt");
    if (modus.value === "aussen" && anMelderGrund.value !== undefined) return anMelderGrund.value;
    // Der Server zählt in Codepunkten und lehnt Längeres ab (WI-0291): Der Grund steht vorher da, nicht erst als Fehler danach.
    return modus.value === "aussen"
        ? zuLangSatz("nachricht", text.value, COMMUNITY_GRENZEN.nachrichtMax)
        : zuLangSatz("text", text.value, COMMUNITY_GRENZEN.notizMax);
});
const eingabeHinweis = computed(() =>
    modus.value === "notiz"
        ? t("community.redaktion.eingabe.nurRedaktion")
        : nurDiscord.value
          ? t("community.redaktion.eingabe.sichtMelderDiscord")
          : t("community.redaktion.eingabe.sichtMelder"),
);
const modi = computed(() => [
    { value: "notiz", label: t("community.redaktion.eingabe.notiz") },
    {
        value: "aussen",
        label: t("community.redaktion.eingabe.anMelder"),
        gesperrt: anMelderGrund.value !== undefined,
        ...(anMelderGrund.value === undefined ? {} : { hinweis: anMelderGrund.value, beschrieben: sperrId }),
    },
]);

/** „Nach Quelle fragen“ schaltet auf An Melder und belegt die Rückfrage vor (Bedienkonzept §2.2 Nr. 2); ein schon geschriebener Text bleibt. */
async function frageNachQuelle(): Promise<void> {
    if (anMelderGrund.value !== undefined) return;
    modus.value = "aussen";
    if (text.value.trim() === "") text.value = t("community.redaktion.nachQuelle.text");
    await nextTick();
    eingabe.value?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
}

// --- Das kleine Blatt ------------------------------------------------------------------------------------------------------

function oeffneBlatt(art: Blatt): void {
    blattFehler.value = undefined;
    blattGrund.value = undefined;
    if (art === "abschliessen" && blatt.value !== "abschliessen") {
        abschluss.value = neuerAbschluss(
            zeile.value?.art ?? "meldung",
            ABSCHLUSS_ERGEBNISSE[zeile.value?.art ?? "meldung"],
            rueckwege.value,
        );
    }
    if (art === "wiedereroeffnen") grund.value = "";
    if (art === "kanal") kanalGesendet.value = undefined;
    blatt.value = art;
}
const schliesseBlatt = (): void => {
    blatt.value = undefined;
    blattFehler.value = undefined;
    blattGrund.value = undefined;
    kanalGesendet.value = undefined;
};

async function schliesseVorgangAb(): Promise<void> {
    const a = abschluss.value;
    const nachricht = a.nachrichtSenden && wegText.value !== "" ? a.nachricht.trim() : "";
    const andere = leseCom(a.dubletteVon);
    const body: Omit<AbschliessenBody, "operationId" | "baseRevision"> = {
        ergebnis: a.ergebnis as AbschliessenBody["ergebnis"],
        begruendung: a.begruendung.trim(),
        ...(nachricht === "" ? {} : { nachricht }),
        ...(a.ergebnis === "dublette" && andere !== undefined ? { dubletteVon: comNummer(andere) } : {}),
    };
    if (await tue(() => schliesseAb(nummer.value, revision(), body))) schliesseBlatt();
}

async function oeffneErneut(): Promise<void> {
    if (await tue(() => oeffneWieder(nummer.value, revision(), grund.value.trim()))) schliesseBlatt();
}

async function loescheBezug(): Promise<void> {
    if (await tue(() => loeschePersonenbezug(nummer.value))) schliesseBlatt();
}

async function mehr(id: string): Promise<void> {
    switch (id) {
        case "wiedereroeffnen":
        case "personenbezug":
            oeffneBlatt(id === "personenbezug" ? "loeschen" : "wiedereroeffnen");
            return;
        case "archivieren":
            await tue(() => archivieren(nummer.value, revision()));
            return;
        case "papierkorb":
            await tue(() => papierkorb(nummer.value, revision()));
            return;
        case "wiederherstellen":
            await tue(() => wiederherstellen(nummer.value, revision()));
            return;
        case "beitrag":
            schlageBeitragVor();
            return;
        case "als-meldung":
            oeffneBlatt("weiterfuehren");
            return;
        case "korrektur":
        case "kanal":
        case "rollen":
            oeffneBlatt(id);
            return;
    }
}

/** „Zuweisen“ im Blatt: die ganze Menge der Sonderrollen; das Blatt schließt, wenn es gelang. */
async function weiseRollenZu(rollen: string[]): Promise<void> {
    if (await tue(() => setzeRollen(nummer.value, revision(), rollen))) {
        rollenEntwurf.value = false;
        schliesseBlatt();
    }
}

/** „Verknüpfen“ im Blatt: die gewählte Änderung gehört zum Vorgang; Zustand und Revision bleiben. */
async function verknuepfeKorrekturGewaehlt(ziel: string): Promise<void> {
    if (await tue(() => verknuepfeKorrektur(nummer.value, ziel))) schliesseBlatt();
}

/** „Weiterreichen“ im Blatt: im Kanal entsteht der Vorgang; das Blatt bleibt mit dem Satz „Weitergereicht als OPS-…“ stehen, der Vorgang offen. */
async function reicheAnKanal(body: Parameters<typeof reicheAnKanalWeiter>[1]): Promise<void> {
    const ergebnis: { ops?: string } = {};
    const ok = await tue(async () => {
        ergebnis.ops = (await reicheAnKanalWeiter(nummer.value, body)).ops;
    });
    if (ok && ergebnis.ops !== undefined) kanalGesendet.value = ergebnis.ops;
}
const oeffneKanal = (ops: string): void => openAuthWindow({ name: "systemsteuerung", eintrag: "claudio", ops });

/**
 * „Als Beitrag vorschlagen“: öffnet das Fenster „Neuer Beitrag“ mit Herkunft COM-…, Rubrik `community` und dem Ergebnis des Vorgangs als Text. Nichts vom Melder geht mit: weder Name und Kontakt noch sein Text,
 * nur der Gegenstand (der Name des Bezugs) und das Wort des Abschlusses. Die Redaktion schreibt den Text um, bevor sie ihn vorlegt.
 */
function schlageBeitragVor(): void {
    const com = leseCom(nummer.value);
    if (com === undefined) return;
    const text = vorlageAusVorgang(
        bezug.value?.name,
        zeile.value?.ergebnis === null || zeile.value === undefined ? undefined : ergebnisName(zeile.value.ergebnis),
    );
    redaktion.oeffneBeitrag(NEUER_BEITRAG, t("community.social.fenster.neu"), {
        text,
        vorgang: com,
        rubrik: "community",
    });
}

// --- Bezug: zeigen, im Editor öffnen, Geist --------------------------------------------------------------------------------

const bezug = computed(() => detail.value?.bezug ?? null);
const bezugTitel = computed(() => {
    const b = bezug.value;
    const z = zeile.value;
    if (b === null || z === undefined) return undefined;
    return b.art === "stelle"
        ? z.bezugName === null
            ? t("community.redaktion.stelle")
            : t("community.redaktion.stelleBei", { ort: z.bezugName })
        : (b.name ?? t("community.redaktion.bezug.ohneName"));
});
const bezugArtText = computed(() => {
    const b = bezug.value;
    if (b === null) return "";
    if (b.art === "stelle") return t("community.redaktion.bezug.freieStelle");
    const key = `community.redaktion.objektart.${b.objektArt ?? ""}`;
    return isMessageKey(key) ? t(key) : "";
});
const gemeldetAls = computed(() => {
    const b = bezug.value;
    if (b === null) return "";
    if (b.art === "stelle") return bezugTitel.value ?? "";
    return b.typ === null ? (b.name ?? "") : `${b.name ?? ""} (${b.typ})`;
});
const fehltArtText = computed(() => {
    const art = detail.value?.fehltArt;
    if (art === null || art === undefined) return undefined;
    const key = `community.fehltArt.${art}`;
    return isMessageKey(key) ? t(key) : art;
});
const vorschlagText = computed(() => {
    const b = bezug.value;
    if (b === null || b.vorschlagLage === null) return undefined;
    if (b.lage === null) return t("community.redaktion.bezug.vorschlagOhne");
    const meilen = distanceInMiles(AVENTURIA.coordinateSpace, b.lage, b.vorschlagLage);
    return t("community.redaktion.bezug.vorschlag", { meilen: formatNumber(meilen, 0) });
});
const editorGrund = computed(() => {
    const key = griffe.value?.editor.grund;
    return key === undefined ? undefined : t(key);
});
const zeigeBezug = (): void => {
    if (bezug.value !== null) redaktion.zeige(bezug.value);
};
const oeffneEditor = (): void => {
    // Die COM-Nummer dieses Vorgangs wird die Herkunft jeder Korrektur am Objekt (WI-0268 C7).
    if (bezug.value !== null && zeile.value !== undefined) redaktion.oeffneImEditor(bezug.value, zeile.value.nummer);
};

/** Der Geist der vorgeschlagenen Lage steht, solange das Fenster zu sehen ist; ein Vorgang ohne Vorschlag räumt ihn weg. */
let meinGeist: ReturnType<typeof vorschlagVon>;
watch(
    [bezug, sichtbar],
    () => {
        if (sichtbar.value && bezug.value !== null) {
            meinGeist = vorschlagVon(bezug.value);
            redaktion.setzeVorschlag(meinGeist);
        } else if (meinGeist !== undefined && redaktion.vorschlag.value === meinGeist) {
            redaktion.setzeVorschlag(undefined);
            meinGeist = undefined;
        }
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    if (meinGeist !== undefined && redaktion.vorschlag.value === meinGeist) redaktion.setzeVorschlag(undefined);
});

const melderName = computed(() => detail.value?.melder.name ?? t("community.redaktion.melder.ohneName"));
/** Der Anzeigename der Discord-Verbindung (WI-0268 C8); nach der Aufbewahrungsfrist (`entfernt`) und ohne Verbindung fehlt er. */
const discordName = computed(() => {
    const melder = detail.value?.melder;
    return melder === undefined || melder.entfernt || melder.discordName == null ? undefined : melder.discordName;
});
const rueckwegText = computed(() => {
    const wege = rueckwege.value.map((weg) => t(`community.redaktion.rueckweg.${weg}`)).join(", ");
    return wege === ""
        ? t("community.redaktion.melder.keinRueckweg")
        : t("community.redaktion.melder.rueckweg", { wege });
});
const unvollstaendig = computed(() => zeile.value?.ohneQuelle === true && zeile.value.zustand !== "abgeschlossen");

/** Esc leert nicht das Fenster, wenn ein Blatt offen ist; das Blatt fängt es selbst. */
const titelZeile = computed(() => {
    const z = zeile.value;
    if (z === undefined) return "";
    // Eine Anfrage hat keinen Bezug: Ihr Titel ist der Betreff, die erste Zeile der Nachricht (Bedienkonzept §3.2).
    if (z.art === "anfrage")
        return z.betreff === null || z.betreff === undefined || z.betreff === ""
            ? kategorieName(z.kategorie)
            : z.betreff;
    return titelVon(z);
});
/** Darf der Verweis aus „Verknüpft“ auf den anderen Vorgang öffnen? Eine Anfrage zu öffnen verlangt `read_mailbox`. */
const darfAnfragen = computed(() => props.rechte.includes("read_mailbox"));
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="links-unten"
        hoehe="inhalt"
        :titel="kopfTitel"
        :ablage-ziel="props.ablageZiel"
        testid="community-vorgang-fenster"
        @update:lage="(neu, neueBox) => emit('update:lage', neu, neueBox)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <template v-if="zeile !== undefined && griffe !== undefined" #leiste>
            <div class="leiste" data-testid="community-vorgang-leiste">
                <div class="leiste__stand">
                    <span class="leiste__zustand" data-testid="community-vorgang-zustand">
                        <AvmKreis :fuellung="kreisVon(zeile.zustand)" :name="standText" />
                        {{ standText }}
                    </span>
                    <template v-if="offenBearbeitbar">
                        <VorgangMenue
                            wahl
                            :eintraege="prioritaetEintraege"
                            :text="
                                t('community.redaktion.prioritaetWert', {
                                    prioritaet: prioritaetName(zeile.prioritaet),
                                })
                            "
                            :bezeichnung="t('community.redaktion.prioritaetWaehlen')"
                            testid="community-vorgang-prioritaet"
                            @waehle="waehlePrioritaet"
                        />
                        <VorgangMenue
                            wahl
                            :eintraege="zustaendigEintraege"
                            :text="t('community.redaktion.zustaendigWert', { name: zustaendigAnzeige })"
                            :bezeichnung="t('community.redaktion.zustaendigWaehlen')"
                            testid="community-vorgang-zustaendig"
                            @waehle="waehleZustaendig"
                        />
                    </template>
                    <template v-else>
                        <AvmPille
                            v-if="prioritaetPille(zeile.prioritaet) !== undefined"
                            :ton="prioritaetPille(zeile.prioritaet)"
                            >{{ prioritaetName(zeile.prioritaet) }}</AvmPille
                        >
                        <span class="leise">{{
                            t("community.redaktion.zustaendigWert", { name: zustaendigAnzeige })
                        }}</span>
                    </template>
                    <AvmPille v-if="archiviert" testid="community-vorgang-archiv">{{
                        t("community.redaktion.segment.archiv")
                    }}</AvmPille>
                    <AvmPille v-if="imPapierkorb" ton="gefahr" testid="community-vorgang-papierkorb">{{
                        t("community.redaktion.papierkorb")
                    }}</AvmPille>
                </div>
                <div class="leiste__griffe">
                    <AvmKnopf
                        v-if="griffe.uebernehmen.zeigen"
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="sendet ? '' : undefined"
                        testid="community-vorgang-uebernehmen"
                        @click="uebernimm"
                    >
                        <template #zeichen><EditorZeichen name="hinzufuegen" /></template>
                        {{ t("community.redaktion.griff.uebernehmen") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="griffe.sichten.zeigen"
                        groesse="zeile"
                        :gesperrt="sendet ? '' : undefined"
                        :title="t('community.redaktion.griff.sichtenHinweis')"
                        testid="community-vorgang-sichten"
                        @click="sichte"
                    >
                        <template #zeichen><EditorZeichen name="ansehen" /></template>
                        {{ t("community.redaktion.griff.sichten") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="istAnfrage && anfrageStand?.insArchiv.zeigen"
                        groesse="zeile"
                        :gesperrt="sendet ? '' : undefined"
                        :title="t('community.mails.griff.insArchivHinweis')"
                        testid="community-vorgang-ins-archiv"
                        @click="insArchivLegen"
                        >↧ {{ t("community.mails.griff.insArchiv") }}</AvmKnopf
                    >
                    <AvmKnopf
                        v-if="istAnfrage && anfrageStand?.zurueck.zeigen"
                        groesse="zeile"
                        :gesperrt="sendet ? '' : undefined"
                        :title="t('community.mails.griff.zurueckHinweis')"
                        testid="community-vorgang-zurueck"
                        @click="zurueckHolen"
                        >↺ {{ t("community.mails.griff.zurueck") }}</AvmKnopf
                    >
                    <AvmKnopf
                        v-if="griffe.abschliessen.zeigen && !istAnfrage"
                        groesse="zeile"
                        :gesperrt="sendet ? '' : undefined"
                        testid="community-vorgang-abschliessen"
                        @click="oeffneBlatt('abschliessen')"
                    >
                        <template #zeichen>
                            <svg class="zeichen" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                <path d="M3 8.5 6.5 12 13 4.5" />
                            </svg>
                        </template>
                        {{ t("community.redaktion.griff.abschliessen") }}
                    </AvmKnopf>
                    <VorgangMenue
                        v-if="mehrEintraege.length > 0"
                        :eintraege="mehrEintraege"
                        :bezeichnung="t('community.redaktion.griff.mehr')"
                        testid="community-vorgang-mehr"
                        @waehle="mehr"
                    />
                </div>
            </div>
        </template>

        <p v-if="stand.art === 'laedt'" class="leise" role="status" data-testid="community-vorgang-laedt">
            {{ t("community.redaktion.laedt") }}
        </p>
        <template v-else-if="stand.art === 'fehler'">
            <AvmHinweis ton="gefahr" rolle="alert" testid="community-vorgang-fehler">{{ stand.satz }}</AvmHinweis>
            <AvmKnopf testid="community-vorgang-erneut" @click="lade(false)">{{
                t("community.redaktion.neuLaden")
            }}</AvmKnopf>
        </template>

        <template v-else-if="detail !== undefined && zeile !== undefined && griffe !== undefined">
            <AvmHinweis
                v-if="meldung !== undefined"
                :ton="meldung.ton"
                rolle="alert"
                testid="community-vorgang-meldung"
                >{{ meldung.satz }}</AvmHinweis
            >

            <VorgangBlatt
                v-if="blatt === 'abschliessen' || blatt === 'wiedereroeffnen' || blatt === 'loeschen'"
                v-model:abschluss="abschluss"
                v-model:grund="grund"
                :art="blatt"
                :nummer="zeile.nummer"
                :vorgang-art="zeile.art"
                :bisher="zeile.ergebnis"
                :weg="wegText"
                :sendet="sendet"
                :fehler="blattFehler"
                :fehler-grund="blattGrund"
                @abschliessen="schliesseVorgangAb"
                @wiedereroeffnen="oeffneErneut"
                @loeschen="loescheBezug"
                @abbrechen="schliesseBlatt"
            />
            <VorgangWeiterfuehren
                v-else-if="blatt === 'weiterfuehren'"
                :nummer="zeile.nummer"
                :vorlage="ersteNachricht"
                :rechte="rechte"
                :sendet="sendet"
                :fehler="blattFehler"
                :fehler-grund="blattGrund"
                @weiter="fuehreWeiter"
                @abbrechen="schliesseBlatt"
                @entwurf="(ja: boolean) => (weiterEntwurf = ja)"
            />
            <VorgangKorrekturBlatt
                v-else-if="blatt === 'korrektur'"
                :nummer="zeile.nummer"
                :sendet="sendet"
                :fehler="blattFehler"
                :fehler-grund="blattGrund"
                @verknuepfe="verknuepfeKorrekturGewaehlt"
                @abbrechen="schliesseBlatt"
            />
            <VorgangKanalBlatt
                v-else-if="blatt === 'kanal'"
                :zeile="zeile"
                :sendet="sendet"
                :fehler="blattFehler"
                :fehler-grund="blattGrund"
                :gesendet="kanalGesendet"
                @senden="reicheAnKanal"
                @oeffne-kanal="oeffneKanal"
                @abbrechen="schliesseBlatt"
                @entwurf="(ja: boolean) => (kanalEntwurf = ja)"
            />
            <VorgangRollenBlatt
                v-else-if="blatt === 'rollen' && detail !== undefined"
                :detail="detail"
                :ich="ich"
                :sendet="sendet"
                :fehler="blattFehler"
                :fehler-grund="blattGrund"
                @zuweisen="weiseRollenZu"
                @abbrechen="schliesseBlatt"
                @entwurf="(ja: boolean) => (rollenEntwurf = ja)"
            />

            <div class="titelzeile">
                <p class="titel" data-testid="community-vorgang-titel">{{ titelZeile }}</p>
                <p v-if="!istAnfrage" class="leise" data-testid="community-vorgang-eingang">{{ eingangText }}</p>
            </div>

            <!-- Zuständig (WI-0279): die Person und die Sonderrollen, je mit wer und wann; der eigene Teil in Gold. -->
            <section
                v-if="zustaendigKasten.length > 0"
                class="kasten"
                data-testid="community-vorgang-zustaendig-kasten"
            >
                <h3 class="kasten__kopf avm-versalmitte">{{ t("community.redaktion.zustaendig.kopf") }}</h3>
                <div
                    v-for="eintrag in zustaendigKasten"
                    :key="eintrag.key"
                    class="zust"
                    :data-testid="`community-vorgang-${eintrag.key}`"
                >
                    <span
                        class="zust__marke"
                        :class="{ 'zust__marke--person': eintrag.art === 'person' }"
                        aria-hidden="true"
                        >{{ eintrag.art === "person" ? eintrag.titel.slice(0, 1).toUpperCase() : "◆" }}</span
                    >
                    <span class="zust__rumpf">
                        <span class="zust__wer"
                            ><span :class="{ zust__mein: eintrag.art === 'person' && eintrag.mein }">{{
                                eintrag.titel
                            }}</span
                            ><template v-if="eintrag.inhaber !== undefined">
                                ·
                                <span v-if="eintrag.inhaber.length === 0" class="leise">{{
                                    t("community.redaktion.zustaendig.niemandInRolle")
                                }}</span
                                ><template v-for="(person, i) in eintrag.inhaber" v-else :key="person.name"
                                    ><template v-if="i > 0">, </template
                                    ><span :class="{ zust__mein: person.mein }">{{ person.name }}</span></template
                                ></template
                            ></span
                        >
                        <span v-if="eintrag.von !== ''" class="leise">{{ eintrag.von }}</span>
                    </span>
                </div>
            </section>

            <section v-if="bezug !== null" class="kasten" data-testid="community-vorgang-bezug">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("community.redaktion.bezug") }}</h3>
                <div class="bezug">
                    <AvmKreis
                        :fuellung="bezug.art === 'stelle' ? 'leer' : 'voll'"
                        :name="
                            bezug.art === 'stelle'
                                ? t('community.redaktion.bezug.freieStelle')
                                : t('community.redaktion.bezug.objekt')
                        "
                    />
                    <span class="bezug__name">{{ bezugTitel }}</span>
                    <span class="leise">{{ bezugArtText }}</span>
                    <span class="bezug__griffe">
                        <AvmKnopf
                            groesse="zeile"
                            :title="t('community.redaktion.bezug.zeigen')"
                            :aria-label="t('community.redaktion.bezug.zeigen')"
                            testid="community-vorgang-zeigen"
                            @click="zeigeBezug"
                            >⊕</AvmKnopf
                        >
                        <AvmKnopf
                            v-if="griffe.editor.zeigen"
                            groesse="zeile"
                            :gesperrt="editorGrund"
                            :grund-bei="editorId"
                            :title="t('community.redaktion.bezug.imEditor')"
                            :aria-label="t('community.redaktion.bezug.imEditor')"
                            testid="community-vorgang-editor"
                            @click="oeffneEditor"
                            >⚙</AvmKnopf
                        >
                    </span>
                </div>
                <AvmSperrgrund v-if="editorGrund !== undefined" :id="editorId" :text="editorGrund" />
                <p v-if="gemeldetAls !== ''" class="leise">
                    {{ t("community.redaktion.bezug.gemeldetAls", { name: gemeldetAls }) }}
                </p>
                <p v-for="zeile in regionZeilen" :key="zeile" class="leise" data-testid="meldung-region">{{ zeile }}</p>
                <!-- Eine gemeldete Bewertung (WI-0269 C10, Fachkonzept §14.5): der Grund und der Weg zur Bewertung, wo sie verborgen oder freigegeben wird. -->
                <div v-if="bezug.bewertungId" class="bezug" data-testid="community-vorgang-bewertung">
                    <span class="leise">{{
                        t("bewertungen.redaktion.vorgang.grund", { grund: grundName(bezug.bewertungGrund ?? null) })
                    }}</span>
                    <span class="bezug__griffe">
                        <AvmKnopf
                            groesse="zeile"
                            testid="community-vorgang-bewertung-oeffnen"
                            @click="oeffneBewertung(bezug.bewertungId)"
                            >{{ t("bewertungen.redaktion.vorgang.oeffnen") }}</AvmKnopf
                        >
                    </span>
                </div>
                <!-- Ein gemeldetes Reisebild (WI-0272): die Vorschau und der Weg in die Medienverwaltung, nur mit deren Recht. Es ist schon freigegeben und liegt unter „erledigt“. -->
                <div v-if="bezug.reisebild" class="bezug" data-testid="community-vorgang-reisebild">
                    <button
                        type="button"
                        class="bezug__bild"
                        :title="t('photobox.stapel.pruefen')"
                        :aria-label="t('photobox.stapel.pruefen')"
                        data-testid="community-vorgang-reisebild-bild"
                        @click="oeffneReisebilder(bezug.reisebild.publicId, 'erledigt')"
                    >
                        <img :src="bezug.reisebild.url" alt="" loading="lazy" decoding="async" draggable="false" />
                    </button>
                    <AvmKnopf
                        groesse="zeile"
                        testid="community-vorgang-reisebild-oeffnen"
                        @click="oeffneReisebilder(bezug.reisebild.publicId, 'erledigt')"
                        >{{ t("photobox.stapel.pruefen") }}</AvmKnopf
                    >
                </div>
                <p v-if="fehltArtText !== undefined" class="leise">{{ t("community.fehlt.art") }} {{ fehltArtText }}</p>
                <p
                    v-if="vorschlagText !== undefined"
                    class="bezug__vorschlag"
                    data-testid="community-vorgang-vorschlag"
                >
                    {{ vorschlagText }}
                    <span class="leise">{{ t("community.redaktion.bezug.vorschlagKarte") }}</span>
                </p>
                <p v-if="detail.quelle !== null" class="leise">
                    {{ t("community.redaktion.bezug.quelle", { quelle: detail.quelle }) }}
                </p>
                <AvmHinweis v-if="unvollstaendig" ton="warnung" rolle="status" testid="community-vorgang-ohne-quelle">
                    {{ t("community.redaktion.ohneQuelleHinweis") }}
                    <span class="hinweis__griff">
                        <AvmKnopf
                            groesse="zeile"
                            :gesperrt="anMelderGrund"
                            :grund-bei="quelleId"
                            testid="community-vorgang-nach-quelle"
                            @click="frageNachQuelle"
                            >{{ t("community.redaktion.nachQuelle") }}</AvmKnopf
                        >
                    </span>
                </AvmHinweis>
                <AvmSperrgrund
                    v-if="unvollstaendig && anMelderGrund !== undefined"
                    :id="quelleId"
                    :text="anMelderGrund"
                />
            </section>

            <VorgangAbsender v-if="istAnfrage" :detail="detail" @oeffne="oeffneAnderen" />
            <section v-else class="kasten" data-testid="community-vorgang-melder">
                <h3 class="kasten__kopf avm-versalmitte">{{ t("community.redaktion.melder") }}</h3>
                <p class="melder__name">{{ melderName }}</p>
                <!-- Verbunden mit Discord (WI-0268 C8): der Anzeigename, bei leerem Namensfeld der einzige Name; nie die Kennung. -->
                <p v-if="discordName !== undefined" class="leise" data-testid="community-vorgang-melder-discord">
                    {{ t("community.redaktion.melder.discord", { name: discordName }) }}
                </p>
                <p v-if="detail.melder.entfernt" class="leise">{{ t("community.redaktion.melder.entfernt") }}</p>
                <p v-else class="leise">{{ rueckwegText }}</p>
            </section>

            <!-- Verknüpft (WI-0268 C4): „Als Meldung weiterführen“ verbindet Meldung und Anfrage in beide Richtungen. -->
            <section
                v-if="detail.verknuepft !== undefined && detail.verknuepft.length > 0"
                class="kasten"
                data-testid="community-vorgang-verknuepft"
            >
                <h3 class="kasten__kopf avm-versalmitte">{{ t("community.mails.verknuepft") }}</h3>
                <p
                    v-for="eintrag in detail.verknuepft"
                    :key="`${eintrag.richtung}-${eintrag.nummer}`"
                    class="verknuepft"
                >
                    <span class="leise">{{
                        t(
                            eintrag.richtung === "von"
                                ? "community.mails.verknuepft.von"
                                : "community.mails.verknuepft.zu",
                        )
                    }}</span>
                    <button
                        v-if="eintrag.richtung === 'zu' || darfAnfragen"
                        type="button"
                        class="verweis"
                        :data-testid="`community-vorgang-verknuepft-${eintrag.nummer}`"
                        @click="oeffneAnderen(eintrag.nummer)"
                    >
                        {{ eintrag.nummer }}
                    </button>
                    <span v-else>{{ eintrag.nummer }}</span>
                </p>
            </section>

            <VorgangVerknuepfungen :detail="detail" :rechte="rechte" />

            <VorgangVerlauf
                :zeilen="verlauf"
                :art="zeile.art"
                :erneut-grund="erneutGrund"
                :erneut-laeuft="erneutLaeuft"
                :nummer="zeile.nummer"
                testid="community-vorgang-verlauf"
                @erneut="erneutSenden"
            />
        </template>

        <!--
            Die Eingabe steht unter der letzten Nachricht, nicht im Fuß am unteren Rand (Betreiber 2026-11-01: „das antwort modul hoch setzen (da wo die
            nachricht aufhört)“; angedockt steht das Fenster von oben bis unten). Wird der Verlauf länger als das Fenster, haftet sie am unteren Rand des
            Rumpfs (`.eingabe-platz`, sticky). Solange ein Blatt offen ist, tritt sie zurück: Das Blatt hat seine eigenen Knöpfe.
        -->
        <div
            v-if="
                stand.art === 'da' &&
                detail !== undefined &&
                zeile !== undefined &&
                griffe !== undefined &&
                blatt === undefined
            "
            class="eingabe-platz"
            data-testid="community-vorgang-eingabe-platz"
        >
            <VorgangAntwort
                v-if="istAnfrage"
                v-model:modus="modus"
                v-model:text="text"
                :grund="antwortStandGrund"
                :sendet="sendet"
                :weg="wegAntwort"
                :adresse="absenderAdresse"
                @notiz="schreibeAnfrageNotiz"
                @antworten="antworte"
            />
            <div v-else ref="eingabe" class="eingabe" data-testid="community-vorgang-eingabe">
                <div class="eingabe__kopf">
                    <AvmSegmente
                        v-model="modus"
                        :options="modi"
                        :label="t('community.redaktion.eingabe.art')"
                        testid="community-vorgang-modus"
                    />
                    <span class="eingabe__hinweis">{{ eingabeHinweis }}</span>
                </div>
                <AvmSperrgrund v-if="anMelderGrund !== undefined" :id="sperrId" :text="anMelderGrund" />
                <AvmTextbereich
                    v-model="text"
                    :zeilen="2"
                    :maxlength="modus === 'aussen' ? COMMUNITY_GRENZEN.nachrichtMax : COMMUNITY_GRENZEN.notizMax"
                    :placeholder="
                        modus === 'notiz'
                            ? t('community.redaktion.eingabe.notizPlatzhalter')
                            : t('community.redaktion.eingabe.rueckfragePlatzhalter')
                    "
                    :aria-label="
                        modus === 'notiz'
                            ? t('community.redaktion.eingabe.notiz')
                            : t('community.redaktion.eingabe.anMelder')
                    "
                    testid="community-vorgang-text"
                />
                <div class="eingabe__knoepfe">
                    <AvmKnopf
                        art="gefuellt"
                        :gesperrt="sendeSperre"
                        testid="community-vorgang-senden"
                        @click="schreibe"
                        >{{ sendeText }}</AvmKnopf
                    >
                </div>
            </div>
        </div>
    </AvmFenster>
</template>

<style scoped>
.leiste {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.leiste__stand,
.leiste__griffe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
}

.leiste__zustand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-strong);
}

/* Das Zeichen von „Abschließen“, gezeichnet wie die der Hülle (16 × 16, Strich 1,5, runde Enden, in der Schriftfarbe). */
.zeichen {
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.titelzeile {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    overflow-wrap: anywhere;
}

/* Ein Kasten des Rumpfs (Probierseite `.kasten`): Kopf in Versalien, darunter die Zeilen. */
.kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.kasten p {
    margin: 0;
}

.kasten__kopf {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Kasten „Zuständig“ (WI-0279, Entwurf „Meldungen an Rollen“): links die Marke (Anfangsbuchstabe der Person, ◆ für eine Rolle), rechts wer und darunter von wem und wann. */
.zust {
    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
}

.zust__marke {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
}

.zust__marke--person {
    border: 1px solid var(--color-border-strong);
    border-radius: 50%;
    background: var(--color-panel-soft);
    color: var(--color-text-strong);
}

.zust__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    overflow-wrap: anywhere;
}

.zust__wer {
    color: var(--color-text-strong);
}

/* Der eigene Teil (die eigene Person, die eigene Rolle) in Gold, wie in der Liste. */
.zust__mein {
    color: var(--color-accent-strong);
}

.bezug {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

/* Das gemeldete Reisebild: feste Größe, damit der Kasten beim Laden nicht springt. */
.bezug__bild {
    flex: none;
    box-sizing: border-box;
    width: 6rem;
    height: 4.5rem;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    cursor: pointer;
    transition:
        border-color 120ms ease,
        opacity 120ms ease;
}

.bezug__bild:hover {
    border-color: var(--color-link-hover);
}

.bezug__bild:active {
    border-color: var(--color-link);
    opacity: 0.8;
}

.bezug__bild:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.bezug__bild img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.bezug__name {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.bezug__griffe {
    display: inline-flex;
    gap: var(--space-4);
    margin-left: auto;
}

.bezug__vorschlag {
    color: var(--color-text);
}

.hinweis__griff {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-4);
}

.verknuepft {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
}

/* Eine Nummer, die einen anderen Vorgang öffnet: ein Verweis im Fließtext, kein Knopf (Zustände nach Guide §30.5). */
.verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
    transition: color 120ms ease;
}

.verweis:hover,
.verweis:active {
    color: var(--color-link-hover);
}

.verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .verweis {
        transition: none;
    }
}

.melder__name {
    color: var(--color-text);
}

/*
 * Der Platz der Eingabe am Ende des Rumpfs: direkt unter der letzten Nachricht; bei langem Verlauf haftet er am unteren Rand. Er deckt das Polster des
 * Rumpfs (`--space-6` / `--space-12` der Hülle) mit ab, damit beim Rollen nichts unter ihm hervorscheint, und trennt sich mit derselben Linie wie ein Fuß.
 */
.eingabe-platz {
    position: sticky;
    bottom: calc(-1 * var(--space-6));
    z-index: 1;
    margin-inline: calc(-1 * var(--space-12));
    padding: var(--space-6) var(--space-12);
    border-top: 1px solid var(--color-divider);
    background: var(--color-panel);
}

/* Die Eingabe über die ganze Breite. */
.eingabe {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-sizing: border-box;
    padding: var(--space-2);
    color: var(--color-text);
    font-size: var(--font-size-body);
    white-space: normal;
}

.eingabe__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.eingabe__hinweis {
    flex: 1 1 12em;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.eingabe__knoepfe {
    display: flex;
    justify-content: flex-end;
}
</style>
