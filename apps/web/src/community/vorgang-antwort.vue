<script setup lang="ts">
import { computed, useId } from "vue";
import { COMMUNITY_GRENZEN, type MailWeg } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { antwortAnText, antwortKnopfKey, antwortSperre } from "./mails-modell";
import { zuLangSatz } from "./redaktion-ablehnung";

/**
 * Der Fuß im Fenster einer Anfrage (WI-0268 C4; Bedienkonzept §3.2, §3.3): der Umschalter **Notiz | Antwort** mit Vorgabe **Notiz**, damit nichts aus Versehen nach außen geht, darüber die Zeile „An: Statusseite“,
 * darunter das Textfeld und die Knöpfe. Er steht im Fußplatz der Hülle (Fuß steht, Rumpf rollt); das Fenster (`vorgang-fenster.vue`) hält Text und Modus, damit der Entwurf nie verloren geht, und führt die Schritte aus.
 *
 * - **Notiz:** „Notiz speichern“, nur für die Redaktion. **Antwort:** „Antworten“ lässt die Anfrage im Eingang (Zustand „wartet auf Antwort“), „Antworten und ins Archiv“ schließt sie mit Ergebnis
 *   „beantwortet“. Ist der Mailweg an und hat der Absender eine Adresse (WI-0268 C6a), geht die Antwort als Mail: Die Zeile darüber nennt „An: ‹Adresse›“ und der Knopf heißt „Antworten“. Sonst geht sie auf die
 *   Statusseite des Absenders; die Zeile darüber und der Knopf („Antworten (Statusseite)“) sagen es.
 * - 🔴 **Gesperrt heißt: ein Satz** (Guide §7, §13.19): ohne `answer_community` (eine Antwort vertritt Avesmaps nach außen), im Archiv („Zum Antworten zurück in den Eingang holen“), im Papierkorb und ohne Rückweg
 *   steht der Modus Antwort gesperrt da, mit dem Grund sichtbar darunter und im Tooltip; eine Notiz geht trotzdem.
 */
const modus = defineModel<string>("modus", { required: true });
const text = defineModel<string>("text", { required: true });
const props = defineProps<{
    /** Warum eine Antwort gerade nicht geht (`antwortGrund` des Modells), oder `undefined`. */
    grund: MessageKey | undefined;
    /** Eine Handlung läuft: alles gesperrt. */
    sendet: boolean;
    /** Wohin die Antwort geht: Mail oder Statusseite (`undefined`: nirgends, dann ist sie ohnehin gesperrt). */
    weg?: MailWeg | undefined;
    /** Die Adresse des Absenders (nur mit `read_mailbox`), für die Zeile „An: …“ bei einer Mail. */
    adresse?: string | null | undefined;
}>();
const emit = defineEmits<{ notiz: []; antworten: [archivieren: boolean] }>();

const sperrId = useId();
const grundText = computed(() => (props.grund === undefined ? undefined : t(props.grund)));
const antwortGesperrt = computed(() => props.grund !== undefined);
const modi = computed(() => [
    { value: "notiz", label: t("community.redaktion.eingabe.notiz") },
    {
        value: "antwort",
        label: t("community.mails.antwort.modus"),
        gesperrt: antwortGesperrt.value,
        ...(grundText.value === undefined ? {} : { hinweis: grundText.value, beschrieben: sperrId }),
    },
]);

const sperre = computed((): string | undefined => {
    if (props.sendet) return "";
    const key = modus.value === "notiz" ? antwortSperre(undefined, text.value) : antwortSperre(props.grund, text.value);
    if (key !== undefined) return t(key);
    // Der Server zählt in Codepunkten und nimmt nicht mehr (WI-0291): Der Grund steht neben dem Knopf, nicht erst als Fehler danach.
    return modus.value === "notiz"
        ? zuLangSatz("text", text.value, COMMUNITY_GRENZEN.notizMax)
        : zuLangSatz("antwort", text.value, COMMUNITY_GRENZEN.nachrichtMax);
});
const hinweis = computed(() =>
    modus.value === "notiz" ? t("community.redaktion.eingabe.nurRedaktion") : antwortAnText(props.weg, props.adresse),
);
</script>

<template>
    <div class="eingabe" data-testid="community-vorgang-eingabe">
        <div class="eingabe__kopf">
            <AvmSegmente
                v-model="modus"
                :options="modi"
                :label="t('community.redaktion.eingabe.art')"
                testid="community-vorgang-modus"
            />
            <span class="eingabe__hinweis" data-testid="community-vorgang-an">{{ hinweis }}</span>
        </div>
        <AvmSperrgrund v-if="grundText !== undefined" :id="sperrId" :text="grundText" />
        <AvmTextbereich
            v-model="text"
            :zeilen="2"
            :maxlength="modus === 'notiz' ? COMMUNITY_GRENZEN.notizMax : COMMUNITY_GRENZEN.nachrichtMax"
            :placeholder="
                modus === 'notiz'
                    ? t('community.redaktion.eingabe.notizPlatzhalter')
                    : t('community.mails.antwort.platzhalter')
            "
            :aria-label="
                modus === 'notiz' ? t('community.redaktion.eingabe.notiz') : t('community.mails.antwort.modus')
            "
            testid="community-vorgang-text"
        />
        <div class="eingabe__knoepfe">
            <AvmKnopf
                v-if="modus === 'notiz'"
                art="gefuellt"
                :gesperrt="sperre"
                testid="community-vorgang-senden"
                @click="emit('notiz')"
                >{{ t("community.redaktion.eingabe.notizSpeichern") }}</AvmKnopf
            >
            <template v-else>
                <AvmKnopf :gesperrt="sperre" testid="community-vorgang-antworten" @click="emit('antworten', false)">{{
                    t(antwortKnopfKey(props.weg))
                }}</AvmKnopf>
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="sperre"
                    testid="community-vorgang-antworten-archiv"
                    @click="emit('antworten', true)"
                    >{{ t("community.mails.antwort.sendenArchiv") }}</AvmKnopf
                >
            </template>
        </div>
    </div>
</template>

<style scoped>
/* Der Fuß: die Eingabe über die ganze Breite. Die Hülle kürzt ihren Hinweis einzeilig und rollt nicht; hier steht ein Block, also bricht er um. */
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
    overflow-wrap: anywhere;
}

.eingabe__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}
</style>
