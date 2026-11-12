<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId, watch } from "vue";
import { COMMUNITY_GRENZEN } from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import { t } from "../i18n/i18n";
import { ladeMailweg } from "./api";
import {
    leereNeueMail,
    neueMailAdresseGueltig,
    neueMailBody,
    neueMailHatEntwurf,
    neueMailSperrSatz,
} from "./mails-modell";
import { redaktionFehler, sendeNeueMail } from "./redaktion-api";
import { redaktionSatz } from "./redaktion-ablehnung";
import { redaktion } from "./redaktion";

/**
 * Das Fenster „Neue Mail“ (WI-0268 C6a; Bedienkonzept WI-0263 §3.5, Fachkonzept §9). Ein Werkzeugfenster der Hülle und der Fensterverwaltung (`werkzeug` `neue-mail`): angedockt links neben dem Panel wie die
 * übrigen Redaktionsfenster, ⧉ lösen, ▥ andocken, − ablegen unter „Offene Bearbeitungen“. Was geschrieben ist, geht nie verloren: Trägt das Fenster einen Entwurf, legt ✕ es ab, statt es zu verwerfen.
 *
 * - **An, Betreff, Text.** „Senden“ steht im Fuß und ist gesperrt, solange etwas fehlt oder das Recht `send_new_mail` oder der Mailweg fehlt; der Grund steht im Fuß daneben und im Tooltip (Guide §7, §13.19). Die
 *   Adresse prüft dasselbe Muster wie der Server: genau eine Adresse, kein Komma, kein Name davor.
 * - **Eine Kennung je Fenster, nicht je Versuch** (ADR-0019): Sendet jemand nach einem Netzfehler noch einmal, trägt es dieselbe `operationId` und legt nie zwei Mails an. Nach dem Senden steht die Nummer da
 *   („Eingereicht als COM-…“) mit dem Weg in den Vorgang; dort steht der Zustellstand.
 * - 🔴 **Die Mail geht als reiner Text von „Avesmaps-Redaktion“** hinaus; der Vorgang liegt danach im Eingang und wartet auf Antwort. Der Server prüft Recht und Tagesgrenze (20 je Person), nicht dieses Fenster.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    /** Der Eintrag der Fensterverwaltung. */
    fenster: WerkzeugFenster;
    /** Die Rechte der Sitzung (`send_new_mail`). */
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

const entwurf = reactive(leereNeueMail());
/** `undefined`: noch nicht gefragt; das Formular steht trotzdem sofort da, „Senden“ wartet auf die Antwort. */
const mailweg = ref<boolean | undefined>(undefined);
const sendet = ref(false);
const versucht = ref(false);
const problem = ref<string | undefined>(undefined);
/** Die Nummer der Bestätigung; gesetzt heißt: eingereicht. */
const nummer = ref<string | undefined>(undefined);
/** Eine Kennung je Mail: Sie überlebt ein erneutes Senden, nicht die nächste Mail. */
let operationId = newOperationId();
const kennungId = useId();

/** Liest den Mailweg neu: beim Öffnen und nach einem Fehler „Mailweg nicht eingerichtet“ (WI-0291), damit „Senden“ danach den Grund nennt, statt es noch einmal zu versuchen. */
const leseMailweg = (): void => {
    void ladeMailweg().then((an) => {
        mailweg.value = an;
    });
};
onMounted(leseMailweg);

const hatEntwurf = computed(() => nummer.value === undefined && neueMailHatEntwurf(entwurf));
watch(
    hatEntwurf,
    (ja) => {
        if (ja !== props.fenster.ungespeichert)
            redaktion.fenster.value?.markiere(props.fenster.id, { ungespeichert: ja });
    },
    { immediate: true },
);

/** Was fehlt oder zu lang ist, als fertiger Satz; die Längen zählt es in Codepunkten wie der Server (WI-0291). */
const grundSatz = computed(() => neueMailSperrSatz(entwurf, props.rechte, mailweg.value));
const gesperrt = computed(() => {
    if (sendet.value) return t("community.sendet");
    // Solange der Server nicht geantwortet hat, ist der Mailweg unbekannt: gesperrt, aber ohne den falschen Satz „nicht eingerichtet“.
    if (grundSatz.value === undefined && mailweg.value === undefined) return t("community.redaktion.laedt");
    return grundSatz.value;
});
/** Die Adresse zeigt den Fehler erst, wenn jemand etwas versucht hat: vorher wäre „a“ schon falsch. */
const anFalsch = computed(() => versucht.value && entwurf.an.trim() !== "" && !neueMailAdresseGueltig(entwurf.an));
const formularOffen = computed(() => nummer.value === undefined);

/** Esc in einem Feld mit Geschriebenem schließt das Fenster nicht (✕ bleibt der ausdrückliche Weg, und legt den Entwurf ab); ohne Geschriebenes geht Esc an die Hülle. */
function escImFormular(event: KeyboardEvent): void {
    if (neueMailHatEntwurf(entwurf)) event.stopPropagation();
}

async function senden(): Promise<void> {
    versucht.value = true;
    if (gesperrt.value !== undefined || sendet.value) return;
    sendet.value = true;
    problem.value = undefined;
    try {
        const antwort = await sendeNeueMail({ operationId, ...neueMailBody(entwurf) });
        nummer.value = antwort.nummer;
        redaktion.geaendert();
    } catch (fehler) {
        const art = redaktionFehler(fehler);
        // Der Server sagt „nicht eingerichtet“ (503), wenn dem Ausführer die Angaben fehlen: derselbe Satz wie der gesperrte Knopf, und der Mailweg wird neu gelesen.
        if (art === "nicht_moeglich") {
            problem.value = t("community.mails.neu.grund.mailweg");
            leseMailweg();
        } else problem.value = redaktionSatz(fehler, {}, art);
    } finally {
        sendet.value = false;
    }
}

/** Nach dem Senden: eine weitere Mail beginnen (neue Kennung, leeres Formular). */
function nochEine(): void {
    operationId = newOperationId();
    Object.assign(entwurf, leereNeueMail());
    nummer.value = undefined;
    versucht.value = false;
    problem.value = undefined;
}

function oeffneVorgang(): void {
    if (nummer.value !== undefined) redaktion.oeffne(nummer.value, nummer.value);
}
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
        :titel="t('community.mails.neu.titel')"
        :ablage-ziel="props.ablageZiel"
        testid="community-neue-mail-fenster"
        @update:lage="(neu, neueBox) => emit('update:lage', neu, neueBox)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <!-- Eingereicht: die Nummer und der Weg in den Vorgang, wo der Zustellstand steht. -->
        <div v-if="nummer !== undefined" class="neue-mail__fertig" data-testid="community-neue-mail-fertig">
            <p class="neue-mail__nummer" role="status">{{ t("community.mails.neu.fertig", { nummer }) }}</p>
            <div class="neue-mail__knoepfe">
                <AvmKnopf testid="community-neue-mail-noch-eine" @click="nochEine">{{
                    t("community.mails.neu")
                }}</AvmKnopf>
                <AvmKnopf art="gefuellt" testid="community-neue-mail-oeffnen" @click="oeffneVorgang">{{
                    t("community.mails.neu.oeffnen")
                }}</AvmKnopf>
            </div>
        </div>

        <form
            v-else
            class="neue-mail"
            data-testid="community-neue-mail-formular"
            novalidate
            @keydown.esc="escImFormular"
            @submit.prevent
        >
            <label class="neue-mail__feld">
                <span class="neue-mail__label">{{ t("community.mails.neu.an") }}</span>
                <AvmEingabe
                    v-model="entwurf.an"
                    :maxlength="COMMUNITY_GRENZEN.mailMax"
                    :ungueltig="anFalsch"
                    :placeholder="t('community.mails.neu.anPlatzhalter')"
                    :aria-describedby="`${kennungId}-an`"
                    autocomplete="off"
                    inputmode="email"
                    testid="community-neue-mail-an"
                />
                <span v-if="anFalsch" :id="`${kennungId}-an`" class="neue-mail__leise">{{
                    t("community.mails.neu.grund.anUngueltig")
                }}</span>
            </label>

            <label class="neue-mail__feld">
                <span class="neue-mail__label">{{ t("community.mails.neu.betreff") }}</span>
                <AvmEingabe
                    v-model="entwurf.betreff"
                    :maxlength="COMMUNITY_GRENZEN.betreffNeuMax"
                    autocomplete="off"
                    testid="community-neue-mail-betreff"
                />
            </label>

            <label class="neue-mail__feld">
                <span class="neue-mail__label"
                    >{{ t("community.mails.neu.text") }}
                    <AvmPille testid="community-neue-mail-zaehler">{{
                        t("community.text.zaehler", { n: entwurf.text.length, max: COMMUNITY_GRENZEN.nachrichtMax })
                    }}</AvmPille></span
                >
                <AvmTextbereich
                    v-model="entwurf.text"
                    :zeilen="8"
                    :maxlength="COMMUNITY_GRENZEN.nachrichtMax"
                    :placeholder="t('community.mails.neu.textPlatzhalter')"
                    testid="community-neue-mail-text"
                />
            </label>

            <p class="neue-mail__leise" data-testid="community-neue-mail-hinweis">
                {{ t("community.mails.neu.hinweis") }}
            </p>

            <AvmHinweis v-if="problem !== undefined" ton="gefahr" rolle="alert" testid="community-neue-mail-problem">
                {{ problem }}
            </AvmHinweis>
        </form>

        <!-- „Senden“ steht im Fuß, damit es auch in einem niedrigen Fenster im Bild bleibt; gesperrt heißt `disabled`, der Grund steht im Fuß daneben und im Tooltip (Guide §12.6, §13.19). -->
        <template v-if="formularOffen" #fuss-hinweis>
            <span
                v-if="gesperrt !== undefined"
                :id="`${kennungId}-grund`"
                data-testid="community-neue-mail-sperrgrund"
                >{{ gesperrt }}</span
            >
        </template>
        <template v-if="formularOffen" #fuss-haupt>
            <button
                type="button"
                :disabled="gesperrt !== undefined"
                :title="gesperrt"
                :aria-describedby="gesperrt === undefined ? undefined : `${kennungId}-grund`"
                data-testid="community-neue-mail-senden"
                @click="senden"
            >
                {{ t("community.mails.neu.senden") }}
            </button>
        </template>
    </AvmFenster>
</template>

<style scoped>
.neue-mail {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.neue-mail__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.neue-mail__label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.neue-mail__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.neue-mail__fertig {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.neue-mail__nummer {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.neue-mail__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}
</style>
