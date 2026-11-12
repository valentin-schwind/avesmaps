<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useId, useTemplateRef, watch } from "vue";
import {
    COMMUNITY_GRENZEN,
    COMMUNITY_KONTAKT_TAGE,
    FEHLT_ARTEN_FORMULAR,
    MELDUNG_KATEGORIEN,
} from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { phoneViewport } from "../controls/phone-viewport";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import { showToast } from "../feedback/toast";
import type { MessageKey } from "../i18n/de";
import { isMessageKey, t } from "../i18n/i18n";
import {
    frischerSchutz,
    nachKopieren,
    pruefeWeiter,
    trotzdemSchluessel,
    warnungSteht,
    type WeiterArt,
} from "../photobox/fertig-schutz";
import LinkKasten from "../photobox/link-kasten.vue";
import { useLinkKopieren } from "../photobox/link-kopieren";
import ReisebildFertigFuss from "../photobox/reisebild-fertig-fuss.vue";
import ReisebildFormularFuss from "../photobox/reisebild-formular-fuss.vue";
import { FEHLER_SATZ, ladeStand, neuesFormular, sendeMeldung, statusAdresse, zeichenZahl } from "./api";
import { besucherSatz, MELDUNG_ABLEHNUNG } from "./besucher-ablehnung";
import DiscordVerbinden from "./discord-verbinden.vue";
import type { BesucherSteuerung } from "./community-besucher";
import {
    betrifftLage,
    betrifftName,
    betrifftObjekt,
    drahtBody,
    FEHLT_ZEICHEN,
    KATEGORIE_ZEICHEN,
    leererEntwurf,
    OBJEKT_ZEICHEN,
    sperrFeld,
    sperrGrund,
    startBetrifft,
    type Betrifft,
    type MeldeBezug,
} from "./meldung-modell";

/**
 * Das Meldeformular der Besucher (WI-0268 C2, im Stil der Upload-Formulare seit WI-0279; Bedienkonzept §2.1 und §2.1a, Fachkonzept §3.2, §6, §10.5; Gestaltung: Entwurf „Meldeformular“ Fassung 5,
 * Betreiber 2026-11-11): „Änderung vorschlagen: ‹Name›“ an einem Objekt, „Hier etwas melden“ an einer Stelle. Ein Werkzeugfenster der Hülle (`AvmFenster`, §1.3): angedockt neben dem Panel, ⧉ lösen, ▥ andocken,
 * ohne Ablage, nur so hoch wie der Inhalt, und die Höhe bleibt beim Ausfüllen stehen. Gebaut wie das Kontaktformular (`kontakt-fenster.vue`): die Stile der Formulare (`formular-stil.css`), der Fuß, der Linkkasten
 * und der Schutz des Links. Was es rechnet, steht in `meldung-modell.ts`, die Aufrufe in `api.ts`, die Karte in `lage-vorschlag.ts`.
 *
 * - **Zeichen statt Bilder:** Alle Zeichen des Formulars kommen aus dem einen Zeichensatz (`editor-zeichen.vue`), keines aus den gemalten Bildern.
 * - **Pflicht sind die Kategorie, bei „Etwas fehlt“ die Art des Fehlenden, und die Beschreibung (10 bis 2000 Zeichen).** Die Quelle ist ein Hinweis („Mit Quelle geht es schneller.“), nie eine Sperre: Eine
 *   Beobachtung soll nicht verloren gehen. „Absenden“ im Fuß ist gesperrt, solange etwas fehlt, aber drückbar: Ein Druck nennt den Grund im Fuß, markiert das Feld, rollt es in Sicht und setzt den Fokus.
 * - **Die Art des Fehlenden** ist die Liste `FEHLT_ARTEN_FORMULAR`; ältere Meldungen mit `gebiet` bleiben gültig, werden aber nicht mehr angeboten.
 * - **Netz weg:** Der Text bleibt, „Nicht gesendet“; erneutes Senden trägt dieselbe Kennung und denselben Schlüssel und legt nie einen zweiten Vorgang an (ADR-0019).
 * - **Grenze erreicht (429):** der Satz mit der Uhrzeit, der Text bleibt. **Modul nicht eingerichtet (503, oder `stand` falsch):** „Meldungen sind gerade nicht möglich“ statt eines toten Knopfs.
 * - **Honigtopf und Zeitfalle** (Fachkonzept §10.5): ein Feld, das ein Mensch nie sieht (aus der Tab-Folge, `aria-hidden`, `inert`, nicht `display: none`, damit einfache Bots es füllen) und die Zeit seit dem
 *   Öffnen. Beides geht mit. Der Server bestätigt einen Bot ohne Vorgang; ein Mensch sieht nie eine falsche Bestätigung, weil die Falle nur Bots trifft.
 * - **Neue Lage zeigen:** nur bei „Lage falsch“ an einem Objekt. Währenddessen ist das Fenster eingeklappt (Kopf und Moduszeile), Esc bricht ab.
 * - **Bestätigung wie beim Kontaktformular:** die Nummer, der Link zur Statusseite im Kasten; ohne kopierten Link hält ✕, Esc, „Schließen“ und „Statusseite öffnen“ einmal an (`fertig-schutz.ts`).
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    bezug: MeldeBezug;
    steuerung: BesucherSteuerung;
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
    /** „Statusseite öffnen“ nach der Bestätigung. */
    status: [schluessel: string];
}>();

const kennung = neuesFormular();
const geoeffnet = performance.now();
const entwurf = reactive(leererEntwurf(props.bezug));
const betrifft = ref<Betrifft>(startBetrifft(props.bezug));
/** `undefined`: noch nicht gefragt; das Formular steht trotzdem sofort da. */
const moeglich = ref<boolean | undefined>(undefined);
const versucht = ref(false);
const sendet = ref(false);
const datenschutzOffen = ref(false);
/** Der Satz zum Fehler, schon in der Sprache (WI-0291: der genaue Grund des Servers, sonst der allgemeine Satz). */
const problem = ref<string | undefined>(undefined);
/** Die Nummer der Bestätigung; gesetzt heißt: gesendet. */
const nummer = ref<string | undefined>(undefined);
const schutz = ref(frischerSchutz());
const kennungId = useId();
const kategorienFeld = useTemplateRef<HTMLElement>("kategorienFeld");
const textFeld = useTemplateRef<HTMLTextAreaElement>("textFeld");
const fehltAbschnitt = useTemplateRef<HTMLElement>("fehltAbschnitt");
const fertigKasten = useTemplateRef<InstanceType<typeof LinkKasten>>("fertigKasten");

onMounted(() => {
    void ladeStand().then((geht) => {
        moeglich.value = geht;
    });
});

// Eine andere Stelle im selben Formular (ein weiterer Rechtsklick): Der Text bleibt; die Wahl „Ort in der Nähe“ gilt nur, solange es einen gibt.
watch(
    () => props.bezug,
    (neu) => {
        if (neu.art === "stelle" && (neu.ort === undefined || betrifft.value === "ort")) betrifft.value = "stelle";
    },
);

// --- Kopf und Wahl ------------------------------------------------------------------------------------------------------------

/** Der Ort in der Nähe der Stelle, wenn es einen gibt: die zweite Wahl unter „Betrifft“. */
const nahOrt = computed(() => (props.bezug.art === "stelle" ? props.bezug.ort : undefined));
/** Der Name des Gemeinten, sobald es ein Objekt ist (am Objekt, oder der Ort in der Nähe ist gewählt). */
const bezugName = computed(() => betrifftName(props.bezug, betrifft.value));
const titel = computed(() =>
    bezugName.value === undefined
        ? t("community.melden.titelStelle")
        : t("community.melden.titelObjekt", { name: bezugName.value }),
);
const unterzeile = computed(() => {
    if (nummer.value !== undefined) return t("community.melden.unterzeileFertig");
    return bezugName.value === undefined
        ? t("community.melden.unterzeileStelle")
        : t("community.melden.unterzeileObjekt", { name: bezugName.value });
});
/** Die Ortsangabe der Stelle im Kopf: „bei Wehrheim“, sonst „Die markierte Stelle“. */
const stelleText = computed(() =>
    nahOrt.value === undefined
        ? t("community.melden.stelle")
        : t("community.melden.stelleBei", { name: nahOrt.value.name }),
);
/** Die Art des Objekts im Kopf („Dorf“), nur wo das Haus ein Wort dafür hat; sonst nichts (der Schlüssel ist nie ein Anzeigewort). */
const objektTyp = computed(() => {
    const bezug = props.bezug;
    if (bezug.art !== "objekt" || bezug.typ === undefined || bezug.objektArt !== "place") return undefined;
    const key = `place.${bezug.typ}`;
    return isMessageKey(key) ? t(key) : undefined;
});

const kategorien = computed(() =>
    MELDUNG_KATEGORIEN.map((wert) => ({
        wert,
        text: t(`community.kategorie.${wert}` as MessageKey),
        zeichen: KATEGORIE_ZEICHEN[wert],
    })),
);
const fehltArten = computed(() =>
    FEHLT_ARTEN_FORMULAR.map((wert) => ({
        wert,
        text: t(`community.fehltArt.${wert}` as MessageKey),
        zeichen: FEHLT_ZEICHEN[wert],
    })),
);

// --- Die neue Lage ------------------------------------------------------------------------------------------------------------

const objektGewaehlt = computed(() => betrifftObjekt(props.bezug, betrifft.value));
const lageAngeboten = computed(() => entwurf.kategorie === "lage" && objektGewaehlt.value);
const vorschlag = computed(() => props.steuerung.vorschlag.value);
const imModus = computed(() => props.steuerung.lageModus.value !== undefined);
const modusName = computed(() => bezugName.value ?? "");

function lageZeigen(): void {
    props.steuerung.starteLageModus({
        name: modusName.value,
        alt: betrifftLage(props.bezug, betrifft.value),
    });
}

// Wer die Kategorie oder das Gemeinte wechselt, so dass es keine neue Lage mehr gibt, nimmt auch den Vorschlag zurück: Er würde sonst unsichtbar mitgesendet.
watch(lageAngeboten, (angeboten) => {
    if (angeboten) return;
    props.steuerung.beendeLageModus();
    props.steuerung.nimmVorschlagZurueck();
});
watch(betrifft, () => {
    props.steuerung.beendeLageModus();
    props.steuerung.nimmVorschlagZurueck();
});

/** Wer „Etwas fehlt“ wählt, sieht die Kacheln darunter: Sie rollen in Sicht (ohne Bewegung bei „weniger Bewegung“). */
watch(
    () => entwurf.kategorie,
    (neu) => {
        if (neu !== "fehlt") return;
        void nextTick(() => rolleInSicht(fehltAbschnitt.value));
    },
);

function rolleInSicht(knoten: HTMLElement | null | undefined): void {
    const reduziert = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    knoten?.scrollIntoView?.({ block: "nearest", behavior: reduziert ? "auto" : "smooth" });
}

/**
 * Esc in einem Feld mit Geschriebenem schließt das Fenster nicht: Zweitausend Zeichen wären mit einem Tastendruck weg (✕ bleibt der ausdrückliche Weg). Ohne Geschriebenes
 * geht Esc wie bei jedem Werkzeugfenster an die Hülle.
 */
function escImFormular(event: KeyboardEvent): void {
    if (entwurf.text.trim() !== "" || entwurf.quelle.trim() !== "" || entwurf.name.trim() !== "")
        event.stopPropagation();
}

// --- Absenden -------------------------------------------------------------------------------------------------------------------

const grund = computed(() => {
    const key = sperrGrund(entwurf);
    return key === undefined ? undefined : t(key, { min: COMMUNITY_GRENZEN.textMin, max: COMMUNITY_GRENZEN.textMax });
});
/** Das Feld, das nach einem Druck auf den gesperrten Knopf markiert ist; es erlischt, sobald es stimmt. */
const fehlt = computed(() => (versucht.value ? sperrFeld(entwurf) : undefined));
const eingegangen = computed(() => nummer.value !== undefined);
/** Steht das Formular da (nicht die Bestätigung, nicht der Satz „geht gerade nicht“)? Nur dann hat das Fenster einen Fuß mit „Absenden“. */
const formularOffen = computed(() => !eingegangen.value && moeglich.value !== false);
const ansicht = computed(() => (eingegangen.value ? "fertig" : moeglich.value === false ? "gesperrt" : "formular"));
const linkAdresse = computed(() => statusAdresse(globalThis.location.origin, kennung.schluessel));

/** Das Feld in Sicht und den Fokus hinein: die erste Kachel der Gruppe oder die Schreibfläche. */
function zeigeFeld(feld: "kategorie" | "fehltArt" | "text"): void {
    if (feld === "text") {
        textFeld.value?.focus();
        return;
    }
    const gruppe = feld === "kategorie" ? kategorienFeld.value : fehltAbschnitt.value;
    rolleInSicht(gruppe);
    gruppe?.querySelector<HTMLInputElement>("input[type=radio]")?.focus({ preventScroll: true });
}

async function absenden(): Promise<void> {
    if (sendet.value) return;
    versucht.value = true;
    datenschutzOffen.value = false;
    const feld = sperrFeld(entwurf);
    if (feld !== undefined) {
        zeigeFeld(feld);
        return;
    }
    sendet.value = true;
    problem.value = undefined;
    try {
        const antwort = await sendeMeldung(
            drahtBody(
                kennung,
                entwurf,
                props.bezug,
                betrifft.value,
                vorschlag.value?.neu,
                performance.now() - geoeffnet,
            ),
        );
        nummer.value = antwort.nummer;
        props.steuerung.beendeLageModus();
    } catch (fehler) {
        problem.value = besucherSatz(fehler, MELDUNG_ABLEHNUNG, {
            zuViele: "community.fehler.zuViele",
            rueckfall: (art) => t(FEHLER_SATZ[art]),
        });
    } finally {
        sendet.value = false;
    }
}

// --- Bestätigung und Schutz vor Verlust ----------------------------------------------------------------------------------------

const linkKopie = useLinkKopieren({
    link: () => linkAdresse.value,
    erfolg: () => {
        schutz.value = nachKopieren();
    },
    misserfolg: () => fertigKasten.value?.markiereLink(),
});
const warnt = computed(() => eingegangen.value && warnungSteht(schutz.value));

watch(eingegangen, (steht) => {
    if (steht) void nextTick(() => fertigKasten.value?.fokussiereKopieren());
});

/** Ein Weg, der den Link aus dem Blick nimmt: `true`, wenn es weitergeht; `false`, wenn der erste Versuch ohne kopierten Link anhält. */
function weiter(art: WeiterArt): boolean {
    if (!eingegangen.value) return true;
    const ergebnis = pruefeWeiter(schutz.value, art);
    schutz.value = ergebnis.schutz;
    if (ergebnis.halt) void nextTick(() => fertigKasten.value?.zeigeLink());
    return !ergebnis.halt;
}

/** ✕ und Esc setzen `offen` an der Hülle: Das Fenster hängt an diesem Modell, dessen Setzer erst prüft, ob der Link verloren ginge. */
const huellenOffen = computed({
    get: () => offen.value,
    set: (auf: boolean) => {
        if (!auf && !weiter("zu")) return;
        offen.value = auf;
    },
});

function fuehreAus(art: WeiterArt | undefined): void {
    if (art === "stand") emit("status", kennung.schluessel);
    else offen.value = false;
}
const schliessenGedrueckt = (): void => {
    if (weiter("zu")) offen.value = false;
};
const statusGedrueckt = (): void => {
    if (weiter("stand")) emit("status", kennung.schluessel);
};
/** „Kopieren“ in der Warnung: kopieren, melden und dann tun, was gewollt war. Ging das Kopieren nicht, bleibt das Fenster stehen. */
async function warnKopieren(): Promise<void> {
    const art = schutz.value.gewarnt;
    if (!(await linkKopie.kopiere())) return;
    showToast(t("ui.copy.done"));
    fuehreAus(art);
}
/** „Trotzdem schließen“ beziehungsweise „Trotzdem weiter“: der zweite Versuch, jetzt ohne Halt. */
const trotzdem = (): void => fuehreAus(schutz.value.gewarnt);
</script>

<template>
    <AvmFenster
        v-model:offen="huellenOffen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="mitte"
        hoehe="inhalt"
        stabil
        :ansicht="ansicht"
        ansicht-nie-hoeher
        ohne-ablage
        telefon-blatt
        :eingeklappt="imModus"
        :titel="titel"
        :unterzeile="imModus ? undefined : unterzeile"
        testid="community-meldung-fenster"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <template #eingeklappt>
            <div v-if="imModus" class="mf-modus" data-testid="community-modusleiste">
                <span class="mf-modus__titel">{{ t("community.lage.modus") }}</span>
                <span>{{ t("community.lage.modusText", { name: modusName }) }}</span>
                <AvmKnopf
                    groesse="zeile"
                    testid="community-lage-abbrechen"
                    @click="props.steuerung.beendeLageModus()"
                    >{{ t("community.lage.abbrechen") }}</AvmKnopf
                >
            </div>
        </template>

        <!-- Gesendet: die Bestätigung im selben Fenster. -->
        <div v-if="nummer !== undefined" class="mf-fertig" data-testid="community-fertig">
            <p class="mf-fertig__nummer" role="status">
                <EditorZeichen name="haken-kreis" class="mf-fertig__zeichen" />{{
                    t("community.fertig.titel", { nummer })
                }}
            </p>
            <p class="rb__satz">{{ t("community.fertig.privat") }}</p>
            <LinkKasten
                ref="fertigKasten"
                testid="community-fertig"
                :titel="t('community.fertig.linkName')"
                :satz="t('community.fertig.linkHinweis')"
                :link="linkAdresse"
                :kopiert="linkKopie.anzeige.value"
                :warnt="warnt"
                :merken-moeglich="false"
                :gemerkt="false"
                @kopieren="linkKopie.kopiere()"
            />
            <!-- „Mit Discord verbinden“ (WI-0268 C8, Bedienkonzept §2.1 Nr. 4): hier, wo der Statuslink steht, nicht im Formular, denn ein Sprung zu Discord mitten aus dem Formular verlöre den Entwurf. -->
            <DiscordVerbinden :schluessel="kennung.schluessel" :verbunden="null" erklaerung-klappt />
            <div class="mf-fertig__knoepfe">
                <AvmKnopf groesse="zeile" testid="community-fertig-status" @click="statusGedrueckt">{{
                    t("community.fertig.statusseite")
                }}</AvmKnopf>
            </div>
        </div>

        <!-- Geht gerade nicht: ein Satz statt eines toten Knopfs. -->
        <AvmHinweis v-else-if="moeglich === false" ton="warnung" rolle="status" testid="community-nicht-moeglich">
            {{ t("community.nichtMoeglich") }} {{ t("community.nichtMoeglich.spaeter") }}
        </AvmHinweis>

        <form
            v-else
            class="rb mf"
            :class="{ 'rb--telefon': phoneViewport }"
            data-testid="community-formular"
            novalidate
            @keydown.esc="escImFormular"
            @submit.prevent
        >
            <!-- Der Kopf im Rumpf: an einer Stelle die Nadel und der Ort, an einem Objekt das Zeichen seiner Art, sein Name und leise, was es ist. -->
            <p v-if="props.bezug.art === 'objekt'" class="rb__stelle" data-testid="community-betrifft">
                <EditorZeichen :name="OBJEKT_ZEICHEN[props.bezug.objektArt]" class="mf-kopf__zeichen" />
                <span class="rb__nur-vorleser">{{ t("community.melden.betrifft") }}</span>
                <span class="rb__ort">{{ props.bezug.name }}</span>
                <span v-if="objektTyp !== undefined" class="rb__frei">{{ objektTyp }}</span>
            </p>
            <p v-else class="rb__stelle" data-testid="community-betrifft">
                <EditorZeichen name="ort" class="mf-kopf__zeichen" />
                <span class="rb__nur-vorleser">{{ t("community.melden.betrifft") }}</span>
                <span class="rb__ort">{{ stelleText }}</span>
            </p>

            <div v-if="nahOrt !== undefined" class="rb__abschnitt" data-testid="community-betrifft-wahl">
                <span :id="`${kennungId}-betrifft`" class="rb__titel">{{ t("community.melden.betrifft") }}</span>
                <div class="rb__chips" role="radiogroup" :aria-labelledby="`${kennungId}-betrifft`">
                    <label class="rb__chip" data-testid="community-betrifft-stelle">
                        <input
                            v-model="betrifft"
                            class="rb__chipwahl"
                            type="radio"
                            :name="`${kennungId}-betrifft`"
                            value="stelle"
                        />
                        <EditorZeichen name="ort" />
                        <span>{{ t("community.melden.stelle") }}</span>
                    </label>
                    <label class="rb__chip" data-testid="community-betrifft-ort">
                        <input
                            v-model="betrifft"
                            class="rb__chipwahl"
                            type="radio"
                            :name="`${kennungId}-betrifft`"
                            value="ort"
                        />
                        <EditorZeichen name="ort" />
                        <span
                            >{{ nahOrt.name }}
                            <span class="rb__frei">{{ t("community.melden.ortNaheKurz") }}</span></span
                        >
                    </label>
                </div>
            </div>

            <div ref="kategorienFeld" class="rb__abschnitt">
                <span :id="`${kennungId}-kategorie`" class="rb__titel">{{ t("community.melden.kategorie") }}</span>
                <div
                    class="mf-kacheln"
                    :class="{ 'is-fehlt': fehlt === 'kategorie' }"
                    role="radiogroup"
                    :aria-labelledby="`${kennungId}-kategorie`"
                >
                    <label
                        v-for="art in kategorien"
                        :key="art.wert"
                        class="mf-kachel"
                        :data-testid="`community-kategorie-${art.wert}`"
                    >
                        <input
                            v-model="entwurf.kategorie"
                            class="mf-kachel__wahl"
                            type="radio"
                            :name="`${kennungId}-kategorie`"
                            :value="art.wert"
                        />
                        <EditorZeichen :name="art.zeichen" class="mf-kachel__zeichen" />
                        <span>{{ art.text }}</span>
                    </label>
                </div>

                <!-- „Neue Lage auf der Karte zeigen“ (freiwillig): währenddessen ist das Fenster eingeklappt, Esc bricht ab. -->
                <div v-if="lageAngeboten" class="mf-lage" data-testid="community-lage">
                    <p
                        v-if="vorschlag !== undefined"
                        class="mf-lage__gesetzt"
                        role="status"
                        data-testid="community-lage-gesetzt"
                    >
                        {{ t("community.lage.gesetzt") }}
                    </p>
                    <div class="mf-lage__zeile">
                        <AvmKnopf groesse="zeile" testid="community-lage-zeigen" @click="lageZeigen">
                            <template #zeichen><EditorZeichen name="ort" /></template>
                            {{ vorschlag === undefined ? t("community.lage.zeigen") : t("community.lage.erneut") }}
                        </AvmKnopf>
                        <span v-if="vorschlag === undefined" class="rb__frei">{{ t("community.freiwillig") }}</span>
                        <AvmKnopf
                            v-else
                            groesse="zeile"
                            testid="community-lage-zurueck"
                            @click="props.steuerung.nimmVorschlagZurueck()"
                        >
                            <template #zeichen><EditorZeichen name="entfernen" /></template>
                            {{ t("community.lage.zurueck") }}
                        </AvmKnopf>
                    </div>
                </div>
            </div>

            <div v-if="entwurf.kategorie === 'fehlt'" ref="fehltAbschnitt" class="rb__abschnitt">
                <span :id="`${kennungId}-fehlt`" class="rb__titel">{{ t("community.fehlt.art") }}</span>
                <div
                    class="mf-bilder"
                    :class="{ 'is-fehlt': fehlt === 'fehltArt' }"
                    role="radiogroup"
                    :aria-labelledby="`${kennungId}-fehlt`"
                    data-testid="community-fehlt-art"
                >
                    <label
                        v-for="art in fehltArten"
                        :key="art.wert"
                        class="mf-bild"
                        :data-testid="`community-fehlt-art-${art.wert}`"
                    >
                        <input
                            v-model="entwurf.fehltArt"
                            class="mf-bild__wahl"
                            type="radio"
                            :name="`${kennungId}-fehlt`"
                            :value="art.wert"
                        />
                        <EditorZeichen :name="art.zeichen" class="mf-bild__zeichen" />
                        <span>{{ art.text }}</span>
                    </label>
                </div>
            </div>

            <div class="rb__abschnitt">
                <div class="rb__titel">
                    <label :for="`${kennungId}-text`"
                        ><EditorZeichen name="bearbeiten" class="mf-titel__zeichen" />{{
                            t("community.text.label")
                        }}</label
                    >
                    <span class="rb__hinweis">{{ t("community.text.hinweis") }}</span>
                    <span class="rb__zaehler" data-testid="community-text-zaehler">{{
                        t("community.melden.zaehler", { n: zeichenZahl(entwurf.text), max: COMMUNITY_GRENZEN.textMax })
                    }}</span>
                </div>
                <textarea
                    :id="`${kennungId}-text`"
                    ref="textFeld"
                    v-model="entwurf.text"
                    class="rb__eingabe"
                    :class="{ 'is-fehlt': fehlt === 'text' }"
                    rows="4"
                    :maxlength="COMMUNITY_GRENZEN.textMax"
                    :placeholder="t('community.text.platzhalter')"
                    :aria-invalid="fehlt === 'text' ? 'true' : undefined"
                    data-testid="community-text"
                ></textarea>
            </div>

            <div class="rb__abschnitt">
                <div class="rb__titel">
                    <label :for="`${kennungId}-quelle`"
                        ><EditorZeichen name="literatur" class="mf-titel__zeichen" />{{
                            t("community.quelle.label")
                        }}</label
                    >
                    <span class="rb__hinweis">{{ t("community.quelle.hinweis") }}</span>
                </div>
                <input
                    :id="`${kennungId}-quelle`"
                    v-model="entwurf.quelle"
                    class="rb__eingabe"
                    type="text"
                    :maxlength="COMMUNITY_GRENZEN.quelleMax"
                    :placeholder="t('community.quelle.platzhalter')"
                    data-testid="community-quelle"
                />
            </div>

            <div class="rb__abschnitt">
                <label class="rb__titel" :for="`${kennungId}-name`"
                    ><EditorZeichen name="spezies" class="mf-titel__zeichen" />{{ t("community.name.label") }}
                    <span class="rb__frei">{{ t("community.freiwillig") }}</span></label
                >
                <input
                    :id="`${kennungId}-name`"
                    v-model="entwurf.name"
                    class="rb__eingabe"
                    type="text"
                    :maxlength="COMMUNITY_GRENZEN.nameMax"
                    :placeholder="t('community.kontakt.name.platzhalter')"
                    autocomplete="nickname"
                    data-testid="community-name"
                />
            </div>

            <!-- Der Honigtopf: für Menschen nicht erreichbar (aus der Tab-Folge, versteckt vor Vorlesern, träge), aber im Dokument; nicht `display: none`. -->
            <div class="rb__honig" aria-hidden="true" inert data-testid="community-honig">
                <input v-model="entwurf.honig" type="text" name="weitere-angaben" tabindex="-1" autocomplete="off" />
            </div>
        </form>

        <!-- „Absenden“ steht im Fuß, damit es auch in einem niedrigen Fenster im Bild bleibt (Guide §12.6, §13.19). -->
        <template v-if="formularOffen" #fuss>
            <ReisebildFormularFuss
                v-model:datenschutz-offen="datenschutzOffen"
                kennung="community"
                schwebend
                :knopf="t('community.absenden')"
                knopf-zeichen="senden"
                :datenschutz-text="t('community.datenschutz', { tage: COMMUNITY_KONTAKT_TAGE })"
                :gesperrt="grund !== undefined"
                :sendet="sendet"
                :grund="versucht ? grund : undefined"
                :problem="problem"
                @hochladen="absenden"
            />
        </template>
        <template v-else-if="eingegangen" #fuss>
            <ReisebildFertigFuss
                :warnt="warnt"
                :trotzdem="trotzdemSchluessel(schutz)"
                :merken-moeglich="false"
                @schliessen="schliessenGedrueckt"
                @warn-kopieren="warnKopieren"
                @trotzdem="trotzdem"
            />
        </template>
    </AvmFenster>
</template>

<style scoped src="../photobox/formular-stil.css"></style>
<style scoped src="./meldung-stil.css"></style>
