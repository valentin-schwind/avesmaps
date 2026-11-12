<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import {
    HASHTAG_MUSTER,
    KANAL_IDS,
    MEDIA_ASSET_TYPES,
    SOCIAL_RUBRIKEN,
    bereinigeHashtags,
    zaehleKanal,
    type KanalId,
    type MediaAllowReason,
    type MediaAssetType,
    type MediaDenyReason,
    type SocialDetail,
} from "@avesmaps3d/shared";
import { authState } from "../auth/session-state";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { grundName, typMehrzahl, zahl } from "../medien/medien-text";
import { rubrikName } from "../news/news";
import { genauerGrund } from "../system/ablehnung";
import { REDAKTION_FEHLER_SATZ, redaktionFehler } from "./redaktion-api";
import { NEUER_BEITRAG, redaktion } from "./redaktion";
import { hashtagVorrat, ladeHashtags } from "./social-hashtags";
import { aktualisiereKanaele } from "./social-kanaele";
import SocialVorschau from "./social-vorschau.vue";
import {
    bestaetigeBildRechte,
    bildOhneUrteil,
    fuehreAus,
    ladeBeitrag,
    ladeBild,
    legeBeitragAn,
    speichereBeitrag,
    sucheBilder,
    type BildWahl,
} from "./social-api";
import {
    ZUSTAND_NAME,
    bearbeitbar,
    bildRechte,
    darfKanalZuruecknehmen,
    kanalBildGrund,
    kanalZurueckSperre,
    formularAus,
    fussVon,
    gleich,
    kanalGrund,
    kanalName,
    kanalOffen,
    kanalStand,
    kanalZeile,
    kreisVon,
    leeresFormular,
    notiz,
    passtNicht,
    pruefungAusFormular,
    socialAblehnung,
    staendeVon,
    urheber,
    verlaufZeilen,
    zaehlerSatz,
    zielAnzeige,
    zielVon,
    type Formular,
    type FussAktion,
    istFreigeber,
} from "./social-modell";

/**
 * Das Fenster EINES Beitrags des Social Hubs (WI-0270 C11; Bedienkonzept §6.5, §1.3). Ein Werkzeugfenster der Hülle und der Fensterverwaltung (`werkzeug` `beitrag`): angedockt links neben dem Panel, ⧉ lösen, ▥
 * andocken, − ablegen unter „Offene Bearbeitungen“. Ein zweiter Beitrag ersetzt den ersten im selben Fenster (`redaktion.ts`); trägt das erste eine Eingabe, wird es abgelegt und geht nicht verloren.
 *
 * - **Breit, zwei Spalten, solange Platz ist.** Links das Verfassen: Titelzeile (nur für Neuigkeiten), Text mit Zähler („328 von 500 Zeichen (engster Kanal: Mastodon)“), Hashtags als Chips, Bild aus der
 *   Medienverwaltung mit Lizenz und Quelle (nur lesbar) und der Bildbeschreibung (Pflicht, sobald ein Bild gewählt ist), Rubrik, „Mit KI erstellt“. Rechts die Kanäle mit der Zählung nach der Regel jedes
 *   Dienstes (auch für Kanäle ohne Verbindung), die Vorschau je Kanal (ein Reiter je Kanal, `social-vorschau.vue`) und der Verlauf.
 * - 🔴 **Eine Zählung für Fenster und Server** (`packages/shared/src/social/zaehlen.ts`): Was hier überläuft, sperrt „Zur Freigabe vorlegen“ und „Freigeben“ mit dem Grund; was der Server nachzählt, ist dasselbe.
 * - **Fuß je Zustand und Recht** (`social-modell.ts`, `fussVon`): Der Verfasser (`social_communication`) speichert und legt vor; wer `manage_news` hat, gibt frei, nimmt zurück, gibt zurück oder veröffentlicht die
 *   Änderung. Den eigenen Beitrag gibt ein Betreiber allein frei (E10), der Verlauf nennt es.
 * - 🔴 **Gleichzeitig arbeiten:** Jeder Schritt trägt die Revision, die diese Seite sah. Ein anderer Stand ist `community_conflict`: Das Fenster sagt „Inzwischen geändert“ und lädt neu; die Eingabe bleibt stehen.
 * - 🔴 **Gesperrt heißt: ein Satz.** Der Hauptknopf nennt den Grund, etwa „Bildbeschreibung fehlt“.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    /** Der Eintrag der Fensterverwaltung: `gegenstand` ist die Nummer des Beitrags oder `neu`. */
    fenster: WerkzeugFenster;
    rechte: readonly string[];
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
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
    | { readonly art: "fehler"; readonly key: MessageKey }
    | { readonly art: "neu" }
    | { readonly art: "da"; readonly detail: SocialDetail };

const gegenstand = computed(() => props.fenster.gegenstand ?? "");
const istNeu = computed(() => gegenstand.value === NEUER_BEITRAG || gegenstand.value === "");
const nummer = computed(() => (istNeu.value ? undefined : Number(gegenstand.value)));
const stand = shallowRef<Stand>({ art: "laedt" });
const detail = computed(() => (stand.value.art === "da" ? stand.value.detail : undefined));
const zeile = computed(() => detail.value?.zeile);
const ich = computed(() => authState.value.person?.id);
const meldung = shallowRef<
    | { readonly key: MessageKey; readonly ton: "warnung" | "gefahr" | "neutral"; readonly grund?: string | undefined }
    | undefined
>(undefined);
let lauf = 0;

const formular = ref<Formular>(leeresFormular());
const basis = ref<Formular>(leeresFormular());
/** Die COM-Nummer (ohne Präfix) bei „Als Beitrag vorschlagen“. */
const vorgang = ref<number | undefined>(undefined);
const sendet = ref(false);
/** Die Nummer eines Beitrags, den dieses Fenster eben angelegt hat: Das Fenster trägt sie dann, ohne neu zu laden und ohne die Eingabe zu verwerfen. */
let angelegtNummer: number | undefined;
const bildInfo = shallowRef<SocialDetail["bild"]>(null);
const bildVorschau = ref<string | null>(null);
const bildOffen = ref(false);
type Blatt = "zurueckgeben" | "zuruecknehmen" | "kanalZuruecknehmen";
/** Wie viele Zeilen das Feld „Text“ mindestens hoch ist (Zeilenhöhe des Kanons): Beiträge sind Absätze, nicht Zeilen. Es wächst mit dem Inhalt und lässt sich ziehen. */
const TEXT_ZEILEN = 13;
const blatt = shallowRef<Blatt | undefined>(undefined);
/** Der Kanal, dessen Beitrag das Blatt „Zurücknehmen“ gerade zurücknimmt (ein Kanal mit Zugang: Mastodon oder Facebook; Instagram nimmt nichts zurück). */
const blattKanal = ref<KanalId>("mastodon");
const grundText = ref("");

const rolle = computed(() => ({
    freigeber: istFreigeber(props.rechte),
    eigen: istNeu.value || (ich.value !== undefined && zeile.value?.verfasser?.id === ich.value),
}));
const editierbar = computed(() => bearbeitbar(zeile.value, rolle.value) && !sendet.value);
const schmutzig = computed(() => !gleich(formular.value, basis.value));

function uebernehme(neu: Formular): void {
    formular.value = { ...neu, hashtags: [...neu.hashtags], kanaele: [...neu.kanaele] };
    basis.value = { ...neu, hashtags: [...neu.hashtags], kanaele: [...neu.kanaele] };
}

async function lade(): Promise<boolean> {
    const mein = ++lauf;
    const zu = nummer.value;
    if (zu === undefined) return false;
    try {
        const antwort = await ladeBeitrag(zu);
        if (mein !== lauf || zu !== nummer.value) return false;
        stand.value = { art: "da", detail: antwort };
        // Eine Eingabe bleibt stehen (ein anderer Stand ersetzt sie nie still); sonst folgt das Formular dem gespeicherten Stand.
        if (!schmutzig.value) uebernehme(formularAus(antwort.zeile));
        else basis.value = formularAus(antwort.zeile);
        bildInfo.value = antwort.bild;
        // Ein gespeicherter Beitrag kennt sein Bild, aber nicht dessen Vorschau: Die steht in der Medienverwaltung.
        if (antwort.bild !== null && bildVorschau.value === null) void ladeVorschau(antwort.bild.id);
        return true;
    } catch (fehler) {
        if (mein !== lauf) return false;
        const art = redaktionFehler(fehler);
        if (stand.value.art !== "da") stand.value = { art: "fehler", key: REDAKTION_FEHLER_SATZ[art] };
        else meldung.value = { key: REDAKTION_FEHLER_SATZ[art], ton: "gefahr" };
        return false;
    }
}

function zuruecksetzen(): void {
    lauf += 1;
    meldung.value = undefined;
    blatt.value = undefined;
    grundText.value = "";
    sendet.value = false;
    bildOffen.value = false;
    bildInfo.value = null;
    setzeVorschau(null);
    vorgang.value = undefined;
    if (istNeu.value) {
        stand.value = { art: "neu" };
        const vorlage = redaktion.nimmBeitragVorlage();
        const f = leeresFormular();
        f.hashtags = [...vorauswahl.value];
        if (vorlage !== undefined) {
            f.text = vorlage.text;
            f.rubrik = vorlage.rubrik;
            vorgang.value = vorlage.vorgang;
        }
        // Eine Vorlage ist noch nicht gespeichert: Das Formular weicht von „leer“ ab, also trägt das Fenster eine Eingabe.
        formular.value = f;
        basis.value = { ...leeresFormular(), hashtags: [...vorauswahl.value] };
        return;
    }
    stand.value = { art: "laedt" };
    uebernehme(leeresFormular());
}
// --- Zählung und Sperren ----------------------------------------------------------------------------------------------------

/** Hat das gewählte Bild geklärte Rechte? `undefined`, solange wir es nicht wissen (dann sperrt nur die Beschreibung). */
const geklaert = computed(() => (formular.value.bild === null ? undefined : bildInfo.value?.geklaert));
/** Ein Bild der Kategorie „Social Media Posts“: Vorlegen und Anhaken gehen auch vor der Bestätigung der Rechte, nur das Freigeben wartet darauf (WI-0278). */
const socialBild = computed(() => bildInfo.value?.typ === "social_post");
const geklaertVorFreigabe = computed(() => (socialBild.value ? undefined : geklaert.value));
/** Kann Meta das Bild abholen? Nur Instagram fragt danach (`pruefeBeitrag`, `kanalBildGrund`). */
const bildOeffentlich = computed(() => (formular.value.bild === null ? undefined : bildInfo.value?.oeffentlich));
/** Warum die Policy das gewählte Bild sperrt (`MediaDenyReason`); er geht in den Sperrgrund und damit in den Satz, was zu tun ist. */
const bildGrund = computed(() => (formular.value.bild === null ? undefined : (bildInfo.value?.grund ?? undefined)));
const sperre = computed(() =>
    passtNicht(
        pruefungAusFormular(formular.value, geklaert.value, bildOeffentlich.value, bildGrund.value),
        socialBild.value,
    ),
);
const vorlageSperre = computed(() =>
    passtNicht(pruefungAusFormular(formular.value, geklaertVorFreigabe.value), socialBild.value),
);
/** Der genaue Grund einer Ablehnung des Servers, in den Sätzen des Fensters (Vali 2026-11-08); ohne ihn der allgemeine Satz. */
const ablehnung = (fehler: unknown): string | undefined => genauerGrund(fehler, socialAblehnung(socialBild.value));
const speichernSperre = computed((): string | undefined => {
    if (!editierbar.value) return "";
    const titel = zaehleKanal("neuigkeiten", {
        titel: formular.value.titel,
        text: "",
        hashtags: [],
    }).titel;
    if (titel !== null && titel.zuviel > 0)
        return t("community.social.sperre.zuLangTitel", { kanal: kanalName("neuigkeiten"), n: String(titel.zuviel) });
    return schmutzig.value || istNeu.value ? undefined : t("community.social.sperre.nichtsZuSpeichern");
});
const fuss = computed(() =>
    fussVon(zeile.value, rolle.value, sperre.value, formular.value, { sperre: vorlageSperre.value }),
);
const staende = computed(() => staendeVon(formular.value));
const zaehler = computed(() => zaehlerSatz(formular.value));
const ueberlauf = computed(() =>
    staende.value.some((stand) => formular.value.kanaele.includes(stand.kanal) && stand.ueber),
);
const verlauf = computed(() => (detail.value === undefined ? [] : verlaufZeilen(detail.value.verlauf)));
const sperrId = useId();

// --- Hashtags ---------------------------------------------------------------------------------------------------------------------

/** Der Vorrat kommt aus der Systemsteuerung (Panel „Hashtags“); ein Beitrag darf daneben eigene tragen. */
const alleHashtags = computed(() => [
    ...new Set([...hashtagVorrat.value.map((hashtag) => hashtag.tag), ...formular.value.hashtags]),
]);
/** Was ein neuer Beitrag schon mitbringt. Es gehört zum leeren Formular: Allein dadurch trägt das Fenster keine Eingabe und wird nicht abgelegt. */
const vorauswahl = computed(() =>
    bereinigeHashtags(hashtagVorrat.value.filter((hashtag) => hashtag.vorausgewaehlt).map((hashtag) => hashtag.tag)),
);
// Die Liste kommt erst mit dem Öffnen des Fensters: Ein neuer Beitrag, an dessen Hashtags noch niemand war, übernimmt sie dann.
watch(vorauswahl, (neu) => {
    if (!istNeu.value || formular.value.hashtags.join(" ") !== basis.value.hashtags.join(" ")) return;
    formular.value.hashtags = [...neu];
    basis.value.hashtags = [...neu];
});
void ladeHashtags();
const neuerHashtag = ref("");
function schalteHashtag(tag: string): void {
    if (!editierbar.value) return;
    const da = formular.value.hashtags.includes(tag);
    formular.value.hashtags = da
        ? formular.value.hashtags.filter((x) => x !== tag)
        : bereinigeHashtags([...formular.value.hashtags, tag]);
}
const hashtagGueltig = computed(() => {
    const rein = neuerHashtag.value.trim().replace(/^#*/u, "#");
    return rein.length > 1 && HASHTAG_MUSTER.test(rein);
});
function fuegeHashtagHinzu(): void {
    if (!editierbar.value || !hashtagGueltig.value) return;
    formular.value.hashtags = bereinigeHashtags([...formular.value.hashtags, neuerHashtag.value]);
    neuerHashtag.value = "";
}

// --- Kanäle -----------------------------------------------------------------------------------------------------------------------

const rubrikOptionen = computed(() => SOCIAL_RUBRIKEN.map((wert) => ({ wert, text: rubrikName(wert) ?? wert })));
function schalteKanal(kanal: KanalId, an: boolean): void {
    if (!editierbar.value || zeile.value?.zustand === "veroeffentlicht" || !kanalOffen(kanal)) return;
    formular.value.kanaele = an
        ? [...new Set([...formular.value.kanaele, kanal])]
        : formular.value.kanaele.filter((x) => x !== kanal);
}
const kanalSperre = (kanal: KanalId): string | undefined => {
    // Ein Kanal mit Zugang ist wählbar, wenn er eingerichtet, freigeschaltet und ohne Notschalter ist; sonst steht der Grund da (Tooltip).
    const grund = kanalGrund(kanal);
    if (grund !== undefined) return grund;
    if (zeile.value?.zustand === "veroeffentlicht") return t("community.social.kanal.sperreVeroeffentlicht");
    // Instagram sendet nur mit einem Bild, das Meta abholen darf (Rechte geklärt): Anhaken geht erst dann; ein schon angehakter Kanal bleibt abwählbar.
    if (!formular.value.kanaele.includes(kanal)) {
        const bildGrund = kanalBildGrund(kanal, formular.value.bild, geklaertVorFreigabe.value, bildOeffentlich.value);
        if (bildGrund !== undefined) return bildGrund;
    }
    return editierbar.value ? undefined : "";
};

// --- Bild aus der Medienverwaltung ----------------------------------------------------------------------------------------------------

const bildSuche = ref("");
const bildTreffer = shallowRef<readonly BildWahl[]>([]);
const bildGesamt = ref(0);
const bildLaedt = ref(false);
const bildFehler = ref(false);
let bildLauf = 0;
/** Die Kategorie der Auswahl; `alle` sucht über jede. Vorn steht die eigene „Social Media Posts“; 3D-Modelle sind keine Bilder. */
const bildTyp = ref<MediaAssetType | "alle">("social_post");
const bildAbschnitte = computed((): FilterAbschnitt[] => [
    {
        id: "typ",
        titel: t("community.social.bild.kategorie"),
        art: "eins",
        werte: [
            { wert: "social_post", text: typMehrzahl("social_post") },
            ...MEDIA_ASSET_TYPES.filter((typ) => typ !== "social_post" && typ !== "model_3d").map((typ) => ({
                wert: typ,
                text: typMehrzahl(typ),
            })),
        ],
    },
]);
const bildWahl = computed((): FilterWahl => (bildTyp.value === "alle" ? {} : { typ: [bildTyp.value] }));
function setzeBildTyp(_abschnitt: string, werte: readonly string[]): void {
    bildTyp.value = (werte[0] as MediaAssetType | undefined) ?? "alle";
}
async function sucheBild(anhaengen = false): Promise<void> {
    const mein = ++bildLauf;
    bildLaedt.value = true;
    bildFehler.value = false;
    try {
        const treffer = await sucheBilder(bildSuche.value, {
            typ: bildTyp.value === "alle" ? undefined : bildTyp.value,
            offset: anhaengen ? bildTreffer.value.length : 0,
        });
        if (mein !== bildLauf) return;
        bildTreffer.value = anhaengen ? [...bildTreffer.value, ...treffer.bilder] : treffer.bilder;
        bildGesamt.value = treffer.gesamt;
        // Noch nichts hochgeladen: Dann zeigt die Auswahl gleich die Bilder, statt mit „Keine Treffer“ anzufangen.
        if (treffer.gesamt === 0 && bildTyp.value === "social_post" && bildSuche.value.trim() === "") {
            bildTyp.value = "picture";
        }
    } catch {
        if (mein === bildLauf) bildFehler.value = true;
    } finally {
        if (mein === bildLauf) bildLaedt.value = false;
    }
}
watch(bildTyp, () => {
    if (bildOffen.value) void sucheBild();
});
let bildTippen: ReturnType<typeof setTimeout> | undefined;
watch(bildSuche, () => {
    clearTimeout(bildTippen);
    if (bildOffen.value) bildTippen = setTimeout(() => void sucheBild(), 250);
});
function oeffneBildwahl(): void {
    bildOffen.value = !bildOffen.value;
    if (bildOffen.value) void sucheBild();
}
/** Die Vorschau; eine aus dem Speicher des Browsers (das eben hochgeladene Bild) wird freigegeben, sobald sie weicht. */
function setzeVorschau(adresse: string | null): void {
    if (bildVorschau.value?.startsWith("blob:") === true) URL.revokeObjectURL(bildVorschau.value);
    bildVorschau.value = adresse;
}
async function ladeVorschau(id: string): Promise<void> {
    try {
        const bild = await ladeBild(id);
        if (formular.value.bild === id && bildVorschau.value === null) setzeVorschau(bild.vorschau);
    } catch {
        // Ohne Vorschau bleibt die gestrichelte Fläche; der Beitrag hängt nicht daran.
    }
}
/** Der Satz zu einem Grund der Policy, derselbe Wortlaut wie in der Medienverwaltung. */
const bildGrundSatz = (grund: string): string =>
    t("community.social.bild.warnung", { grund: grundName(grund as MediaAllowReason | MediaDenyReason) });
/** Wählbar ist, was die Lizenz zulässt. Ein Bild der Kategorie „Social Media Posts“ bleibt es auch vor der Bestätigung: Die gibt, wer freigibt. */
const bildWaehlbar = (bild: BildWahl): boolean => bild.erlaubt || bild.typ === "social_post";
function waehleBild(bild: BildWahl): void {
    formular.value.bild = bild.id;
    bildInfo.value = {
        id: bild.id,
        titel: bild.titel,
        rechtsbasis: bild.rechtsbasis,
        klaerung: bild.klaerung,
        geklaert: bild.erlaubt,
        grund: bild.grund,
        nennung: bild.nennung,
        oeffentlich: bild.oeffentlich,
        typ: bild.typ,
    };
    setzeVorschau(bild.vorschau);
    bildOffen.value = false;
}
// --- Bild hochladen: dasselbe Formular wie überall, das Bild landet in der Kategorie „Social Media Posts“ (WI-0278) ---------------------
const MedienHochladenFenster = defineAsyncComponent(() => import("../medien/medien-hochladen-fenster.vue"));
const hochladenOffen = ref(false);
const darfHochladen = computed(
    () =>
        authState.value.capabilities.includes("upload_media") ||
        authState.value.capabilities.includes("upload_social_image"),
);
async function hochgeladen(ergebnis: { assetId: string; datei?: File | undefined }): Promise<void> {
    const lokal = ergebnis.datei === undefined ? null : URL.createObjectURL(ergebnis.datei);
    try {
        const bild = await ladeBild(ergebnis.assetId);
        // Die Vorschau des Servers rechnet der Abgleich erst noch: So lange zeigt das Fenster die Datei selbst.
        waehleBild({ ...bild, vorschau: bild.vorschau ?? lokal });
    } catch {
        // Das Bild gibt es; nur sein Stand kam nicht an. Beim nächsten Laden des Beitrags steht er da.
        waehleBild(
            bildOhneUrteil({
                id: ergebnis.assetId,
                titel: null,
                rechtsbasis: null,
                klaerung: null,
                vorschau: lokal,
                typ: null,
            }),
        );
    }
    if (lokal !== null && bildVorschau.value !== lokal) URL.revokeObjectURL(lokal);
}
const rechteSendet = ref(false);
const rechteOffen = computed(() => socialBild.value && bildInfo.value?.klaerung !== "cleared");
/** Warum das gewählte Bild nicht hinausgeht. Ein Bild der Kategorie „Social Media Posts“ wartet nur auf die Bestätigung; bei jedem anderen nennt der Satz den Grund der Policy. */
const bildWarnung = computed((): string | undefined => {
    const bild = bildInfo.value;
    if (bild === null || bild.geklaert) return undefined;
    if (rechteOffen.value && !rolle.value.freigeber) return t("community.social.bild.rechteWarten");
    if (rechteOffen.value) return t("community.social.sperre.bildNichtGeklaert");
    return bildGrundSatz(bild.grund ?? "rights_missing");
});
/** Der Hinweis auf die Nennung, die die Lizenz verlangt. */
const nennungSatz = computed((): string | undefined => {
    const nennung = bildInfo.value?.nennung;
    if (nennung === null || nennung === undefined) return undefined;
    return nennung === "" ? t("community.social.bild.nennungFehlt") : t("community.social.bild.nennung", { nennung });
});
/** Warum „Rechte bestätigen“ nicht geht: Eine unbekannte Grundlage lässt sich nicht bestätigen, sie ist nie öffentlich (Policy). */
const rechteSperre = computed((): string | undefined => {
    if (rechteSendet.value) return "";
    const basis = bildInfo.value?.rechtsbasis;
    return basis === "unknown" || basis === null ? t("community.social.bild.rechteUnbekannt") : undefined;
});
async function bestaetigeRechte(): Promise<void> {
    const bild = bildInfo.value;
    if (bild === null || rechteSendet.value) return;
    rechteSendet.value = true;
    try {
        const antwort = await bestaetigeBildRechte(bild.id);
        if (bildInfo.value?.id === bild.id) {
            // Das Urteil DANACH: Bestätigte Rechte heben nicht jede Sperre der Policy auf; ein älterer Server schickt nur `geklaert`.
            bildInfo.value = {
                ...bild,
                klaerung: antwort.klaerung,
                geklaert: antwort.geklaert,
                ...(antwort.grund === undefined ? {} : { grund: antwort.grund }),
                ...(antwort.nennung === undefined ? {} : { nennung: antwort.nennung }),
                ...(antwort.oeffentlich === undefined ? {} : { oeffentlich: antwort.oeffentlich }),
            };
        }
    } catch (fehler) {
        meldung.value = {
            key: REDAKTION_FEHLER_SATZ[redaktionFehler(fehler)],
            ton: "gefahr",
            grund: ablehnung(fehler),
        };
    } finally {
        rechteSendet.value = false;
    }
}
function entferneBild(): void {
    formular.value.bild = null;
    formular.value.bildBeschreibung = "";
    bildInfo.value = null;
    setzeVorschau(null);
}
const bildSatz = computed(() =>
    bildInfo.value === null ? "" : bildRechte(bildInfo.value.rechtsbasis, bildInfo.value.klaerung),
);

// --- Blätter und Schritte -------------------------------------------------------------------------------------------------------------

const blattWurzel = useTemplateRef<HTMLElement>("blattWurzel");

/**
 * Führt eine Handlung aus und lädt danach neu. Ein veralteter Stand (`community_conflict`) oder ein Übergang, der nicht mehr geht, laden den Beitrag neu und sagen es; die Eingabe bleibt stehen.
 * `true`, wenn die Handlung gelungen ist.
 */
async function tue(handlung: () => Promise<unknown>): Promise<boolean> {
    if (sendet.value) return false;
    sendet.value = true;
    meldung.value = undefined;
    try {
        await handlung();
    } catch (fehler) {
        const art = redaktionFehler(fehler);
        const key = REDAKTION_FEHLER_SATZ[art];
        if (art === "konflikt" || art === "uebergang") {
            meldung.value = { key, ton: "warnung" };
            blatt.value = undefined;
            sendet.value = false;
            if (!istNeu.value) await lade();
            redaktion.geaendert();
        } else {
            meldung.value = { key, ton: "gefahr", grund: ablehnung(fehler) };
            sendet.value = false;
        }
        return false;
    }
    blatt.value = undefined;
    sendet.value = false;
    if (!istNeu.value) await lade();
    redaktion.geaendert();
    return true;
}

/** Sorgt dafür, dass der Beitrag gespeichert ist, und gibt Nummer und Revision zurück. Ein neuer wird angelegt (das Fenster trägt danach seine Nummer). */
async function gespeichert(): Promise<{ id: number; revision: number }> {
    const z = zeile.value;
    if (z === undefined) {
        const q = await legeBeitragAn(formular.value, vorgang.value);
        angelegtNummer = q.id;
        basis.value = {
            ...formular.value,
            hashtags: [...formular.value.hashtags],
            kanaele: [...formular.value.kanaele],
        };
        redaktion.beitragAngelegt(props.fenster.id, String(q.id), `${q.nr} · ${t(ZUSTAND_NAME[q.zustand])}`);
        return { id: q.id, revision: q.revision };
    }
    if (!schmutzig.value) return { id: z.id, revision: z.revision };
    const q = await speichereBeitrag(z.id, z.revision, formular.value);
    basis.value = { ...formular.value, hashtags: [...formular.value.hashtags], kanaele: [...formular.value.kanaele] };
    return { id: z.id, revision: q.revision };
}

const aktion = (art: FussAktion): Promise<boolean> => {
    switch (art) {
        case "speichern":
            return tue(async () => {
                await gespeichert();
            }).then((ok) => {
                if (ok) meldung.value = { key: "community.social.meldung.gespeichert", ton: "neutral" };
                return ok;
            });
        case "vorlegen":
        case "freigeben":
        case "aenderung":
            return tue(async () => {
                const g = await gespeichert();
                await fuehreAus(g.id, art, g.revision);
            });
        case "zurueckziehen":
        case "zurueckholen":
            return tue(() => fuehreAus(zeile.value?.id ?? 0, art, zeile.value?.revision ?? 1));
        case "verwerfen":
            return tue(() => fuehreAus(zeile.value?.id ?? 0, "papierkorb", zeile.value?.revision ?? 1));
        case "zurueckgeben":
            blatt.value = "zurueckgeben";
            grundText.value = "";
            return Promise.resolve(true);
        case "zuruecknehmen":
            blatt.value = "zuruecknehmen";
            return Promise.resolve(true);
    }
};
const oeffneKanalBlatt = (kanal: KanalId): void => {
    blattKanal.value = kanal;
    blatt.value = "kanalZuruecknehmen";
};
const sendeKanalZuruecknehmen = (): Promise<boolean> =>
    tue(() =>
        fuehreAus(zeile.value?.id ?? 0, "kanal-zuruecknehmen", zeile.value?.revision ?? 1, { kanal: blattKanal.value }),
    );
const sendeZurueckgeben = (): Promise<boolean> =>
    tue(() =>
        fuehreAus(zeile.value?.id ?? 0, "zurueckgeben", zeile.value?.revision ?? 1, { grund: grundText.value.trim() }),
    );
const sendeZuruecknehmen = (): Promise<boolean> =>
    tue(() => fuehreAus(zeile.value?.id ?? 0, "zuruecknehmen", zeile.value?.revision ?? 1));
const sendeErneut = (kanal: KanalId): Promise<boolean> =>
    tue(() => fuehreAus(zeile.value?.id ?? 0, "erneut", zeile.value?.revision ?? 1, { kanal }));

function escBlatt(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Esc bricht das Blatt ab, nicht das ganze Fenster.
    event.preventDefault();
    event.stopPropagation();
    blatt.value = undefined;
}

const knopfGrund = (k: { gesperrt?: string | undefined }): string | undefined => (sendet.value ? "" : k.gesperrt);
const fussGrund = computed(
    () => fuss.value.knoepfe.find((k) => k.gesperrt !== undefined && k.gesperrt !== "")?.gesperrt,
);
const zielName = (kanal: KanalId) => zielVon(detail.value, kanal);
const darfErneut = (kanal: KanalId): boolean => {
    const ziel = zielName(kanal);
    return (
        rolle.value.freigeber &&
        zeile.value?.zustand === "veroeffentlicht" &&
        (ziel?.zustand === "fehler" || ziel?.zustand === "zurueck") &&
        !zeile.value.papierkorb
    );
};
/** Was das Fenster zum Ziel eines Kanals zeigt: Chip, Link zum Beitrag dort, Grund eines Fehlers, was aussteht. */
const anzeigeVon = (kanal: KanalId) => {
    const ziel = zielName(kanal);
    return ziel === undefined ? undefined : zielAnzeige(ziel);
};
const darfKanalZurueck = (kanal: KanalId): boolean => darfKanalZuruecknehmen(zeile.value, kanal, rolle.value.freigeber);
/** Warum „Zurücknehmen“ bei diesem Kanal gesperrt ist (Instagram: kein Löschen über die Schnittstelle). */
const kanalZurueckGrund = (kanal: KanalId): string | undefined =>
    kanalZurueckSperre(zeile.value, kanal, rolle.value.freigeber);
const notizSatz = computed(() => (zeile.value === undefined ? undefined : notiz(zeile.value)));

// Der Stand der fremden Kanäle (eingerichtet, freigeschaltet, Notschalter, Grenzen der Instanz) bestimmt Wahl und Zähler; er kommt mit dem Öffnen des Fensters.
void aktualisiereKanaele();

// Solange ein Auftrag an einen fremden Kanal läuft („wird gesendet …“), sieht das Fenster alle fünf Sekunden nach, bis er durch ist (er braucht Sekunden, nicht Minuten); sonst gibt es keinen Takt.
const ausstehend = computed(() => zeile.value?.ziele.some((ziel) => ziel.ausstehend !== null) === true);
let takt: ReturnType<typeof setInterval> | undefined;
watch(
    ausstehend,
    (ja) => {
        if (takt !== undefined) clearInterval(takt);
        takt = ja ? setInterval(() => void lade(), 5000) : undefined;
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    clearTimeout(bildTippen);
    setzeVorschau(null);
    if (takt !== undefined) clearInterval(takt);
});
const heute = computed(() =>
    (zeile.value?.veroeffentlichtAt ?? null) === null
        ? t("community.social.vorschau.heute")
        : new Date(zeile.value?.veroeffentlichtAt ?? 0).toLocaleDateString(),
);

// --- Wechsel des Gegenstands und Rückmeldung an die Fensterverwaltung ---------------------------------------------------------------
watch(
    gegenstand,
    (neu, alt) => {
        // Ein neuer Beitrag wurde gespeichert: Dasselbe Fenster trägt nun dessen Nummer, die Eingabe ist schon gespeichert.
        if (alt === NEUER_BEITRAG && neu !== NEUER_BEITRAG && angelegtNummer === Number(neu)) {
            angelegtNummer = undefined;
            stand.value = { art: "laedt" };
            void lade();
            return;
        }
        zuruecksetzen();
        if (!istNeu.value) void lade();
    },
    { immediate: true },
);

// Der Titel des Fensters und der Entwurf (Eingabe) gehören der Fensterverwaltung.
const kopfTitel = computed(() => {
    const z = zeile.value;
    return z === undefined ? t("community.social.fenster.neu") : `${z.nr} · ${t(ZUSTAND_NAME[z.zustand])}`;
});
watch(
    kopfTitel,
    (titel) => {
        if (titel !== props.fenster.titel) redaktion.fenster.value?.markiere(props.fenster.id, { titel });
    },
    { immediate: true },
);
watch(
    schmutzig,
    (ja) => {
        if (ja !== props.fenster.ungespeichert)
            redaktion.fenster.value?.markiere(props.fenster.id, { ungespeichert: ja });
    },
    { immediate: true },
);
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="werkzeug"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="links-unten"
        hoehe="inhalt"
        :titel="kopfTitel"
        :ablage-ziel="props.ablageZiel"
        testid="community-social-fenster"
        @update:lage="(neu, neueBox) => emit('update:lage', neu, neueBox)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <template v-if="stand.art === 'da' || stand.art === 'neu'" #leiste>
            <div class="leiste" data-testid="community-social-leiste">
                <span class="leiste__zustand" data-testid="community-social-zustand">
                    <AvmKreis
                        :fuellung="kreisVon(zeile?.zustand ?? 'entwurf')"
                        :name="t(ZUSTAND_NAME[zeile?.zustand ?? 'entwurf'])"
                    />
                    {{ t(ZUSTAND_NAME[zeile?.zustand ?? "entwurf"]) }}
                </span>
                <span v-if="zeile !== undefined" class="leise">{{ urheber(zeile) }}</span>
                <AvmPille v-if="formular.ki" ton="neutral">{{ t("community.social.status.mitKi") }}</AvmPille>
                <AvmPille v-if="zeile?.papierkorb" ton="gefahr">{{ t("community.social.status.papierkorb") }}</AvmPille>
                <span v-if="notizSatz !== undefined" class="notiz" data-testid="community-social-notiz">{{
                    notizSatz
                }}</span>
            </div>
        </template>

        <p v-if="stand.art === 'laedt'" class="leise" role="status" data-testid="community-social-laedt">
            {{ t("community.redaktion.laedt") }}
        </p>
        <template v-else-if="stand.art === 'fehler'">
            <AvmHinweis ton="gefahr" rolle="alert" testid="community-social-fehler">{{ t(stand.key) }}</AvmHinweis>
            <AvmKnopf testid="community-social-erneut-laden" @click="lade()">{{
                t("community.redaktion.neuLaden")
            }}</AvmKnopf>
        </template>

        <template v-else>
            <AvmHinweis
                v-if="meldung !== undefined"
                :ton="meldung.ton"
                rolle="alert"
                testid="community-social-meldung"
                >{{ meldung.grund ?? t(meldung.key) }}</AvmHinweis
            >

            <!-- Das kleine Blatt: IM Fenster, am Anfang des Rumpfs; das Fenster wächst mit. -->
            <section
                v-if="blatt === 'zurueckgeben'"
                ref="blattWurzel"
                class="blatt"
                :aria-label="t('community.social.blatt.zurueckgeben.titel', { name: zeile?.verfasser?.name ?? '' })"
                data-testid="community-social-blatt-zurueckgeben"
                @keydown="escBlatt"
            >
                <h3 class="blatt__titel avm-versalmitte">
                    {{ t("community.social.blatt.zurueckgeben.titel", { name: zeile?.verfasser?.name ?? "" }) }}
                </h3>
                <label class="feld">
                    <span class="feld__titel">{{ t("community.social.blatt.grund") }}</span>
                    <AvmTextbereich v-model="grundText" :zeilen="2" testid="community-social-grund" />
                </label>
                <div class="blatt__knoepfe">
                    <AvmKnopf :gesperrt="sendet ? '' : undefined" @click="blatt = undefined">{{
                        t("community.social.blatt.abbrechen")
                    }}</AvmKnopf>
                    <AvmKnopf
                        art="gefuellt"
                        :gesperrt="sendet ? '' : undefined"
                        testid="community-social-zurueckgeben-senden"
                        @click="sendeZurueckgeben"
                        >{{ t("community.social.blatt.zurueckgeben.senden") }}</AvmKnopf
                    >
                </div>
            </section>
            <section
                v-else-if="blatt === 'zuruecknehmen'"
                ref="blattWurzel"
                class="blatt"
                :aria-label="t('community.social.blatt.zuruecknehmen.titel', { nr: zeile?.nr ?? '' })"
                data-testid="community-social-blatt-zuruecknehmen"
                @keydown="escBlatt"
            >
                <h3 class="blatt__titel avm-versalmitte">
                    {{ t("community.social.blatt.zuruecknehmen.titel", { nr: zeile?.nr ?? "" }) }}
                </h3>
                <p class="blatt__text">{{ t("community.social.blatt.zuruecknehmen.text") }}</p>
                <div class="blatt__knoepfe">
                    <AvmKnopf :gesperrt="sendet ? '' : undefined" @click="blatt = undefined">{{
                        t("community.social.blatt.abbrechen")
                    }}</AvmKnopf>
                    <AvmKnopf
                        art="gefahr"
                        :gesperrt="sendet ? '' : undefined"
                        testid="community-social-zuruecknehmen-senden"
                        @click="sendeZuruecknehmen"
                        >{{ t("community.social.blatt.zuruecknehmen.senden") }}</AvmKnopf
                    >
                </div>
            </section>
            <section
                v-else-if="blatt === 'kanalZuruecknehmen'"
                ref="blattWurzel"
                class="blatt"
                :aria-label="
                    t('community.social.blatt.kanalZuruecknehmen.titel', {
                        nr: zeile?.nr ?? '',
                        kanal: kanalName(blattKanal),
                    })
                "
                data-testid="community-social-blatt-kanal-zuruecknehmen"
                @keydown="escBlatt"
            >
                <h3 class="blatt__titel avm-versalmitte">
                    {{
                        t("community.social.blatt.kanalZuruecknehmen.titel", {
                            nr: zeile?.nr ?? "",
                            kanal: kanalName(blattKanal),
                        })
                    }}
                </h3>
                <p class="blatt__text">
                    {{ t("community.social.blatt.kanalZuruecknehmen.text", { kanal: kanalName(blattKanal) }) }}
                </p>
                <div class="blatt__knoepfe">
                    <AvmKnopf :gesperrt="sendet ? '' : undefined" @click="blatt = undefined">{{
                        t("community.social.blatt.abbrechen")
                    }}</AvmKnopf>
                    <AvmKnopf
                        art="gefahr"
                        :gesperrt="sendet ? '' : undefined"
                        testid="community-social-kanal-zuruecknehmen-senden"
                        @click="sendeKanalZuruecknehmen"
                        >{{ t("community.social.blatt.zuruecknehmen.senden") }}</AvmKnopf
                    >
                </div>
            </section>

            <div class="spalten">
                <!-- Links: Verfassen -->
                <div class="spalte" data-testid="community-social-verfassen">
                    <label class="feld">
                        <span class="feld__titel"
                            >{{ t("community.social.feld.titel") }}
                            <span class="feld__zusatz">{{ t("community.social.feld.titelZusatz") }}</span></span
                        >
                        <AvmEingabe
                            v-model="formular.titel"
                            :gesperrt="editierbar ? undefined : ''"
                            :ungueltig="(staende.find((s) => s.kanal === 'neuigkeiten')?.titel?.zuviel ?? 0) > 0"
                            testid="community-social-titel"
                        />
                    </label>
                    <label class="feld">
                        <span class="feld__titel">{{ t("community.social.feld.text") }}</span>
                        <AvmTextbereich
                            v-model="formular.text"
                            :zeilen="TEXT_ZEILEN"
                            waechst
                            :gesperrt="editierbar ? undefined : ''"
                            :ungueltig="ueberlauf"
                            testid="community-social-text"
                        />
                        <span
                            class="zaehler"
                            :class="{ 'is-zuviel': ueberlauf }"
                            aria-live="polite"
                            data-testid="community-social-zaehler"
                            >{{ zaehler }}</span
                        >
                    </label>
                    <div class="feld">
                        <span class="feld__titel">{{ t("community.social.feld.hashtags") }}</span>
                        <div class="hashtags" data-testid="community-social-hashtags">
                            <button
                                v-for="tag in alleHashtags"
                                :key="tag"
                                type="button"
                                class="hashtag"
                                :class="{ 'is-an': formular.hashtags.includes(tag) }"
                                :aria-pressed="formular.hashtags.includes(tag)"
                                :disabled="!editierbar"
                                @click="schalteHashtag(tag)"
                            >
                                {{ tag }}
                            </button>
                        </div>
                        <div v-if="editierbar" class="hashtag-neu">
                            <AvmEingabe
                                v-model="neuerHashtag"
                                :aria-label="t('community.social.feld.hashtagNeu')"
                                :placeholder="t('community.social.feld.hashtagNeu')"
                                testid="community-social-hashtag-neu"
                                @keydown.enter.prevent="fuegeHashtagHinzu"
                            />
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="hashtagGueltig ? undefined : ''"
                                testid="community-social-hashtag-hinzu"
                                @click="fuegeHashtagHinzu"
                                >{{ t("community.social.feld.hashtagHinzu") }}</AvmKnopf
                            >
                        </div>
                    </div>
                    <div class="feld">
                        <span class="feld__titel">{{ t("community.social.feld.bild") }}</span>
                        <div v-if="formular.bild !== null" class="bildwahl" data-testid="community-social-bild">
                            <img v-if="bildVorschau !== null" :src="bildVorschau" alt="" class="bildwahl__vorschau" />
                            <div class="bildwahl__text">
                                <span class="stark">{{ bildInfo?.titel ?? t("community.social.bild.ohneTitel") }}</span>
                                <span class="leise">{{ bildSatz }}</span>
                                <span
                                    v-if="bildWarnung !== undefined"
                                    class="notiz"
                                    data-testid="community-social-bild-notiz"
                                    >{{ bildWarnung }}</span
                                >
                                <span
                                    v-if="nennungSatz !== undefined"
                                    class="notiz"
                                    data-testid="community-social-bild-nennung"
                                    >{{ nennungSatz }}</span
                                >
                                <div class="bildwahl__knoepfe">
                                    <AvmKnopf
                                        v-if="rechteOffen && rolle.freigeber"
                                        groesse="zeile"
                                        :gesperrt="rechteSperre"
                                        testid="community-social-bild-rechte"
                                        @click="bestaetigeRechte"
                                        >{{ t("community.social.bild.rechteBestaetigen") }}</AvmKnopf
                                    >
                                    <AvmKnopf
                                        v-if="editierbar"
                                        groesse="zeile"
                                        testid="community-social-bild-weg"
                                        @click="entferneBild"
                                        >{{ t("community.social.bild.entfernen") }}</AvmKnopf
                                    >
                                </div>
                            </div>
                        </div>
                        <div v-else class="bildwahl__knoepfe">
                            <AvmKnopf
                                v-if="darfHochladen"
                                groesse="zeile"
                                :gesperrt="editierbar ? undefined : ''"
                                testid="community-social-bild-hochladen"
                                @click="hochladenOffen = true"
                                >{{ t("community.social.bild.hochladen") }}</AvmKnopf
                            >
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="editierbar ? undefined : ''"
                                testid="community-social-bild-waehlen"
                                @click="oeffneBildwahl"
                                >{{ t("community.social.bild.waehlen") }}</AvmKnopf
                            >
                        </div>
                        <section v-if="bildOffen" class="bildliste" data-testid="community-social-bildliste">
                            <AvmListenleiste
                                v-model="bildSuche"
                                :platzhalter="t('community.social.bild.suche')"
                                :beschriftung="t('community.social.bild.suche')"
                                testid="community-social-bild-leiste"
                            >
                                <AvmFilterknopf
                                    :abschnitte="bildAbschnitte"
                                    :wahl="bildWahl"
                                    testid="community-social-bild-filter"
                                    @setze="setzeBildTyp"
                                    @loesen="bildTyp = 'alle'"
                                />
                            </AvmListenleiste>
                            <p v-if="bildLaedt && bildTreffer.length === 0" class="leise" role="status">
                                {{ t("community.redaktion.laedt") }}
                            </p>
                            <p v-else-if="bildFehler" class="notiz">{{ t("community.social.bild.fehler") }}</p>
                            <p v-else-if="bildTreffer.length === 0" class="leise">
                                {{ t("community.social.bild.keine") }}
                            </p>
                            <ul v-else class="bildliste__liste">
                                <li v-for="treffer in bildTreffer" :key="treffer.id">
                                    <button
                                        type="button"
                                        class="bildliste__zeile"
                                        :disabled="!bildWaehlbar(treffer)"
                                        :data-testid="`community-social-bild-${treffer.id}`"
                                        @click="waehleBild(treffer)"
                                    >
                                        <img v-if="treffer.vorschau !== null" :src="treffer.vorschau" alt="" />
                                        <span v-else class="bildliste__ohne-bild" />
                                        <span class="bildwahl__text">
                                            <span class="stark">{{
                                                treffer.titel ?? t("community.social.bild.ohneTitel")
                                            }}</span>
                                            <span class="leise">{{
                                                bildRechte(treffer.rechtsbasis, treffer.klaerung)
                                            }}</span>
                                            <span
                                                v-if="!bildWaehlbar(treffer)"
                                                class="notiz"
                                                :data-testid="`community-social-bild-warnung-${treffer.id}`"
                                                >{{ bildGrundSatz(treffer.grund) }}</span
                                            >
                                        </span>
                                    </button>
                                </li>
                            </ul>
                            <AvmKnopf
                                v-if="!bildFehler && bildTreffer.length > 0 && bildTreffer.length < bildGesamt"
                                groesse="zeile"
                                :gesperrt="bildLaedt ? '' : undefined"
                                testid="community-social-bild-mehr"
                                @click="sucheBild(true)"
                                >{{
                                    t("medien.auswahl.mehr", { n: zahl(bildTreffer.length), von: zahl(bildGesamt) })
                                }}</AvmKnopf
                            >
                        </section>
                    </div>
                    <label v-if="formular.bild !== null" class="feld">
                        <span class="feld__titel">{{ t("community.social.feld.beschreibung") }}</span>
                        <AvmEingabe
                            v-model="formular.bildBeschreibung"
                            :placeholder="t('community.social.feld.beschreibungPlatzhalter')"
                            :gesperrt="editierbar ? undefined : ''"
                            :ungueltig="formular.bildBeschreibung.trim() === ''"
                            testid="community-social-beschreibung"
                        />
                    </label>
                    <label class="feld">
                        <span class="feld__titel"
                            >{{ t("community.social.feld.rubrik") }}
                            <span class="feld__zusatz">{{ t("community.social.feld.rubrikZusatz") }}</span></span
                        >
                        <AvmAuswahl
                            v-model="formular.rubrik"
                            :optionen="rubrikOptionen"
                            :gesperrt="editierbar ? undefined : ''"
                            testid="community-social-rubrik"
                        />
                    </label>
                    <AvmKaestchen
                        art="checkbox"
                        :checked="formular.ki"
                        :gesperrt="editierbar ? undefined : ''"
                        testid="community-social-ki"
                        @change="(an: boolean) => (formular.ki = an)"
                        >{{ t("community.social.feld.ki") }}</AvmKaestchen
                    >
                </div>

                <!-- Rechts: Kanäle und Vorschau -->
                <div class="spalte" data-testid="community-social-kanaele">
                    <div class="feld">
                        <span class="feld__titel">{{ t("community.social.kanaele") }}</span>
                        <ul class="kanaele">
                            <li
                                v-for="kanal in KANAL_IDS"
                                :key="kanal"
                                class="kanal"
                                :class="{ 'is-gesperrt': !kanalOffen(kanal) }"
                            >
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="formular.kanaele.includes(kanal)"
                                    :gesperrt="kanalSperre(kanal)"
                                    :hinweis="kanalSperre(kanal)"
                                    :testid="`community-social-kanal-${kanal}`"
                                    @change="(an: boolean) => schalteKanal(kanal, an)"
                                    >{{ kanalName(kanal) }}</AvmKaestchen
                                >
                                <span class="leise"
                                    >{{ t(`community.social.kanal.satz.${kanal}` as MessageKey) }} ·
                                    {{ kanalStand(kanal) }}</span
                                >
                                <span
                                    class="kanal__zahl"
                                    :class="{ 'is-zuviel': staende.find((s) => s.kanal === kanal)?.ueber }"
                                    :data-testid="`community-social-zahl-${kanal}`"
                                    >{{ kanalZeile(staende.find((s) => s.kanal === kanal)!) }}</span
                                >
                                <span v-if="anzeigeVon(kanal) !== undefined" class="kanal__ziel">
                                    <span
                                        class="chip"
                                        :class="`chip--${zielName(kanal)?.zustand}`"
                                        :data-testid="`community-social-chip-${kanal}`"
                                        >{{ anzeigeVon(kanal)?.chip }}</span
                                    >
                                    <a
                                        v-if="anzeigeVon(kanal)?.link"
                                        class="kanal__link"
                                        :href="anzeigeVon(kanal)?.link ?? undefined"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        :data-testid="`community-social-link-${kanal}`"
                                        >{{ t("community.social.ziel.ansehen") }}</a
                                    >
                                    <span
                                        v-if="anzeigeVon(kanal)?.ausstehend"
                                        class="leise"
                                        :data-testid="`community-social-ausstehend-${kanal}`"
                                        >{{ anzeigeVon(kanal)?.ausstehend }}</span
                                    >
                                    <span
                                        v-if="anzeigeVon(kanal)?.grund"
                                        class="kanal__grund"
                                        role="status"
                                        :data-testid="`community-social-grund-${kanal}`"
                                        >{{ anzeigeVon(kanal)?.grund }}</span
                                    >
                                    <AvmKnopf
                                        v-if="darfErneut(kanal)"
                                        groesse="zeile"
                                        :gesperrt="sendet ? '' : undefined"
                                        :testid="`community-social-erneut-${kanal}`"
                                        @click="sendeErneut(kanal)"
                                        >{{ t("community.social.knopf.erneut") }}</AvmKnopf
                                    >
                                    <AvmKnopf
                                        v-if="darfKanalZurueck(kanal)"
                                        groesse="zeile"
                                        :gesperrt="sendet ? '' : undefined"
                                        :testid="`community-social-kanal-zuruecknehmen-${kanal}`"
                                        @click="oeffneKanalBlatt(kanal)"
                                        >{{ t("community.social.knopf.kanalZuruecknehmen") }}</AvmKnopf
                                    >
                                    <AvmKnopf
                                        v-else-if="kanalZurueckGrund(kanal) !== undefined"
                                        groesse="zeile"
                                        :gesperrt="kanalZurueckGrund(kanal)"
                                        :testid="`community-social-kanal-zuruecknehmen-${kanal}`"
                                        >{{ t("community.social.knopf.kanalZuruecknehmen") }}</AvmKnopf
                                    >
                                </span>
                            </li>
                        </ul>
                        <p class="leise">{{ t("community.social.kanaele.hinweis") }}</p>
                    </div>

                    <!-- Die Vorschau je Kanal (WI-0270, Probierseite V15): ein Reiter je Kanal der Liste, der Beitrag im Stil des Dienstes -->
                    <div class="feld">
                        <span class="feld__titel">{{ t("community.social.vorschau") }}</span>
                        <SocialVorschau
                            :kanaele="formular.kanaele"
                            :titel="formular.titel"
                            :text="formular.text"
                            :hashtags="formular.hashtags"
                            :rubrik="formular.rubrik"
                            :heute="heute"
                            :hat-bild="formular.bild !== null"
                            :bild-url="bildVorschau"
                            :bild-beschreibung="formular.bildBeschreibung"
                        />
                    </div>

                    <div v-if="verlauf.length > 0" class="feld">
                        <span class="feld__titel">{{ t("community.social.verlauf") }}</span>
                        <ol class="verlauf" data-testid="community-social-verlauf">
                            <li v-for="eintrag in verlauf" :key="eintrag.key">
                                <span class="leise">{{ eintrag.zeit }}</span> · {{ eintrag.text }}
                            </li>
                        </ol>
                    </div>
                </div>
            </div>
        </template>

        <!-- Der Fuß je Zustand und Recht (Bedienkonzept §6.5): links wohin der Beitrag geht, rechts die Knöpfe. Solange ein Blatt offen ist, gehört der Platz dem Blatt. -->
        <template v-if="(stand.art === 'da' || stand.art === 'neu') && blatt === undefined" #fuss-hinweis>
            <div class="fuss" data-testid="community-social-fuss">
                <p class="fuss__satz" data-testid="community-social-fusssatz">{{ fuss.satz }}</p>
                <div v-if="fuss.knoepfe.length > 0" class="fuss__knoepfe">
                    <AvmKnopf
                        v-for="knopf in fuss.knoepfe"
                        :key="knopf.aktion"
                        :art="knopf.haupt ? 'gefuellt' : 'weich'"
                        :gesperrt="knopf.aktion === 'speichern' ? (sendet ? '' : speichernSperre) : knopfGrund(knopf)"
                        :grund-bei="sperrId"
                        :testid="`community-social-${knopf.aktion}`"
                        @click="aktion(knopf.aktion)"
                        >{{ knopf.text }}</AvmKnopf
                    >
                </div>
                <AvmSperrgrund v-if="fussGrund !== undefined" :id="sperrId" :text="fussGrund" />
            </div>
        </template>
        <MedienHochladenFenster
            v-if="hochladenOffen"
            v-model:offen="hochladenOffen"
            rolle="social_post"
            weg="social"
            @fertig="hochgeladen"
        />
    </AvmFenster>
</template>

<style scoped>
.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.leiste__zustand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-strong);
}

.leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.stark {
    color: var(--color-text-strong);
}

/* Die Notiz in der Warnungsfläche (Bedienkonzept §7); Fehler beim Versand in der Gefahrfläche. */
.notiz {
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

/* Zwei Spalten, solange Platz ist; am Telefon untereinander. */
.spalten {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--avm-fenster-lesespalte)), 1fr));
    gap: var(--space-12);
}

.spalte {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.feld :deep(.eingabe-huelle),
.feld :deep(.textbereich-huelle) {
    display: flex;
    width: 100%;
}

.feld__titel {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.feld__zusatz {
    color: var(--color-text-muted);
    letter-spacing: normal;
    text-transform: none;
}

.zaehler {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.zaehler.is-zuviel,
.kanal__zahl.is-zuviel {
    color: var(--color-danger-soft-text);
}

.hashtags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.hashtag {
    box-sizing: border-box;
    height: var(--space-20);
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    transition: background-color 120ms ease;
}

.hashtag:hover:not(:disabled) {
    background: var(--color-hover-wash);
}

.hashtag.is-an {
    border-color: var(--color-accent-strong);
    background: var(--color-panel-active);
}

.hashtag:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.hashtag:disabled {
    border-color: var(--color-disabled-border);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.hashtag-neu {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

.bildwahl {
    display: flex;
    gap: var(--space-6);
    align-items: flex-start;
}

.bildwahl__vorschau {
    width: calc(var(--space-24) * 3);
    height: calc(var(--space-24) * 2);
    object-fit: cover;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.bildwahl__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    align-items: flex-start;
}

.bildwahl__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.bildliste {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.bildliste__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.bildliste__zeile {
    display: flex;
    gap: var(--space-6);
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-4);
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.bildliste__zeile:hover:not(:disabled) {
    background: var(--color-hover-wash);
}

.bildliste__zeile:disabled {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.bildliste__zeile:disabled img {
    filter: grayscale(1);
}

.bildliste__zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.bildliste__zeile img,
.bildliste__ohne-bild {
    flex: none;
    width: calc(var(--space-24) * 2);
    height: calc(var(--space-24) * 1.5);
    object-fit: cover;
    border-radius: var(--radius-md);
}

.bildliste__ohne-bild {
    box-sizing: border-box;
    border: 1px solid var(--color-disabled-border);
    background: var(--color-disabled-bg);
}

.kanaele {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.kanal {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.kanal.is-gesperrt {
    border-style: dashed;
}

.kanal__zahl {
    color: var(--color-text);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.kanal__ziel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.chip {
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.chip--ok {
    border-color: var(--color-success-soft-border);
    color: var(--color-success-soft-text);
}

.kanal__link {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
}

.kanal__grund {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
}

.chip--fehler {
    border-color: var(--color-danger-soft-border);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}

.verlauf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-small);
}

/* Das kleine Blatt: dieselbe Fassung wie im Vorgangsfenster (`vorgang-blatt.vue`). */
.blatt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.blatt__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.blatt__text {
    margin: 0;
    color: var(--color-text);
}

.blatt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}

/* Der Fuß: ein Block (die Hülle kennt nur Hinweis und Knöpfe), also bricht er um. */
.fuss {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-sizing: border-box;
    padding: var(--space-2);
    color: var(--color-text);
    font-size: var(--font-size-body);
    white-space: normal;
}

.fuss__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.fuss__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-6);
}
</style>
