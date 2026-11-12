<script setup lang="ts">
import type { CommunityArt } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import MailAnhaenge from "./mail-anhaenge.vue";
import MailAnsicht from "./mail-ansicht.vue";
import { zustellSatz } from "./mails-modell";
import { zeitPunkt, type VerlaufZeile } from "./meldungen-modell";

/**
 * Der Verlauf eines Vorgangs in Zeitfolge (WI-0268 C3; Bedienkonzept §2.2 Nr. 4, Fachkonzept §5): die Meldung und die Nachrichten des Melders, die Nachrichten an ihn, die Notizen und die Ereignisse.
 *
 * - 🔴 **Notizen stehen in der Warnungsfläche und tragen das Wort „intern“**: Was die Redaktion unter sich schreibt, geht nie nach außen (Fachkonzept §5). Nachrichten nach außen tragen „an Melder“.
 * - **Eine ausgehende Mail trägt ihren Zustellstand** (WI-0268 C6a, Bedienkonzept §3.3): „An: ‹Adresse›“ und „wird gesendet …“, „✓ zugestellt“ oder „nicht zugestellt: ‹Grund›“; bei „nicht zugestellt“ steht
 *   „Erneut senden“ dabei (gesperrt mit Grund, wo das Recht `answer_community` fehlt). „Zugestellt“ heißt vom Mailserver angenommen, nicht gelesen.
 * - **Eine eingehende Mail** (WI-0268 C6b, Bedienkonzept §3.2) trägt ihren Betreff; eine HTML-Mail steht formatiert in einer abgeschotteten Fläche (`mail-ansicht.vue`: ohne Skriptrecht, bereinigt, externe Bilder
 *   blockiert mit „Einmal laden“), eine Mail ohne HTML als Text. Ihre Anhänge stehen darunter (`mail-anhaenge.vue`). Eine Mail, die nicht übernommen wurde (zu groß, nicht lesbar), sagt es statt des Textes.
 * - **Ereignisse sind kurze Zeilen** in Alltagssprache („gesichtet · Vali“, „abgeschlossen: umgesetzt“); die Begründung eines Abschlusses und der Grund einer Wiedereröffnung stehen darunter
 *   und sind intern (die Begründung ist Pflicht und bleibt unveränderlich, Fachkonzept §4.3).
 */
const props = defineProps<{
    zeilen: readonly VerlaufZeile[];
    testid?: string | undefined;
    /** Bei einer Anfrage (WI-0268 C4) heißen die Köpfe „Nachricht“, „Antwort“ und „Antwort des Absenders“ statt „Meldung“, „an Melder“ und „Antwort des Melders“. */
    art?: CommunityArt | undefined;
    /** Warum „Erneut senden“ gesperrt ist (kein Recht, Papierkorb); `undefined`: es geht. */
    erneutGrund?: string | undefined;
    /** Die Kennung der Nachricht, deren „Erneut senden“ gerade läuft: der Knopf ist solange gesperrt. */
    erneutLaeuft?: number | undefined;
    /** Die COM-Nummer des Vorgangs: Die Adressen der Anhänge enthalten sie. */
    nummer?: string | undefined;
}>();
const emit = defineEmits<{ erneut: [nachricht: number] }>();

/** Die erste Nachricht des Melders ist die Meldung selbst; spätere sind seine Antworten. */
function nachrichtKopf(zeile: Extract<VerlaufZeile, { art: "nachricht" }>, erste: boolean): string {
    const anfrage = props.art === "anfrage";
    if (zeile.richtung === "aus")
        return t(anfrage ? "community.mails.verlauf.antwort" : "community.redaktion.verlauf.anMelder");
    if (erste) return t(anfrage ? "community.mails.verlauf.nachricht" : "community.redaktion.verlauf.meldung");
    return t(anfrage ? "community.mails.verlauf.antwortAbsender" : "community.redaktion.verlauf.antwortMelder");
}

/** Der Satz zu einer Mail, die nur aus Kopfzeilen besteht. */
function mailHinweis(hinweis: "zu_gross" | "unlesbar"): string {
    return t(hinweis === "zu_gross" ? "community.mails.hinweis.zuGross" : "community.mails.hinweis.unlesbar");
}

function ersteEinNachricht(zeilen: readonly VerlaufZeile[], key: string): boolean {
    return zeilen.find((zeile) => zeile.art === "nachricht" && zeile.richtung === "ein")?.key === key;
}
</script>

<template>
    <ol class="verlauf" :aria-label="t('community.redaktion.verlauf')" :data-testid="testid">
        <template v-for="zeile in zeilen" :key="zeile.key">
            <li
                v-if="zeile.art === 'nachricht'"
                class="eintrag"
                :class="zeile.richtung === 'aus' ? 'eintrag--aus' : 'eintrag--ein'"
                :data-testid="`${testid ?? 'verlauf'}-nachricht`"
            >
                <div class="eintrag__kopf">
                    <span>{{ nachrichtKopf(zeile, ersteEinNachricht(zeilen, zeile.key)) }}</span>
                    <span v-if="zeile.von !== undefined">· {{ zeile.von }}</span>
                    <span class="eintrag__zeit">{{ zeitPunkt(zeile.at) }}</span>
                </div>
                <template v-if="zeile.mail !== undefined && nummer !== undefined">
                    <p
                        v-if="zeile.mail.betreff !== ''"
                        class="eintrag__betreff"
                        :data-testid="`${testid ?? 'verlauf'}-betreff`"
                    >
                        {{ zeile.mail.betreff }}
                    </p>
                    <p
                        v-if="zeile.mail.hinweis !== null"
                        class="eintrag__text eintrag__leise"
                        :data-testid="`${testid ?? 'verlauf'}-hinweis`"
                    >
                        {{ mailHinweis(zeile.mail.hinweis) }}
                    </p>
                    <MailAnsicht
                        v-else-if="zeile.mail.html !== null"
                        :html="zeile.mail.html"
                        :extern-bilder="zeile.mail.externBilder"
                        :testid="`${testid ?? 'verlauf'}-html`"
                    />
                    <p v-else-if="zeile.text !== null" class="eintrag__text">{{ zeile.text }}</p>
                    <p v-else class="eintrag__text eintrag__leise">{{ t("community.status.entfernt") }}</p>
                    <MailAnhaenge
                        v-if="zeile.mail.anhaenge.length > 0"
                        :nummer="nummer"
                        :anhaenge="zeile.mail.anhaenge"
                        :testid="`${testid ?? 'verlauf'}-anhaenge`"
                    />
                </template>
                <template v-else>
                    <p v-if="zeile.text !== null" class="eintrag__text">{{ zeile.text }}</p>
                    <p v-else class="eintrag__text eintrag__leise">{{ t("community.status.entfernt") }}</p>
                </template>
                <p
                    v-if="zeile.zustellung !== undefined"
                    class="zustellung"
                    :class="`zustellung--${zeile.zustellung.zustand}`"
                    :data-testid="`${testid ?? 'verlauf'}-zustellung`"
                >
                    <span v-if="zeile.zustellung.an !== null" class="eintrag__leise">{{
                        t("community.mails.gesendet.an", { adresse: zeile.zustellung.an })
                    }}</span>
                    <span class="zustellung__stand" :data-testid="`${testid ?? 'verlauf'}-zustand`">{{
                        zustellSatz(zeile.zustellung)
                    }}</span>
                    <AvmKnopf
                        v-if="zeile.zustellung.zustand === 'fehler' && zeile.id !== undefined"
                        groesse="zeile"
                        :gesperrt="erneutLaeuft === zeile.id ? '' : erneutGrund"
                        testid="community-vorgang-erneut-senden"
                        @click="emit('erneut', zeile.id)"
                        >{{ t("community.mails.zustellung.erneut") }}</AvmKnopf
                    >
                </p>
            </li>
            <li
                v-else-if="zeile.art === 'notiz'"
                class="eintrag eintrag--notiz"
                :data-testid="`${testid ?? 'verlauf'}-notiz`"
            >
                <div class="eintrag__kopf">
                    <span>{{ t("community.redaktion.verlauf.intern") }}</span>
                    <span v-if="zeile.von !== undefined">· {{ zeile.von }}</span>
                    <span class="eintrag__zeit">{{ zeitPunkt(zeile.at) }}</span>
                </div>
                <p class="eintrag__text">{{ zeile.text }}</p>
            </li>
            <li v-else class="ereignis" :data-testid="`${testid ?? 'verlauf'}-ereignis`">
                <span>{{ zeitPunkt(zeile.at) }} · {{ zeile.satz }}</span>
                <span v-if="zeile.text !== undefined" class="ereignis__text">
                    <span class="eintrag__leise">{{ t("community.redaktion.verlauf.interneBegruendung") }}</span>
                    {{ zeile.text }}
                </span>
            </li>
        </template>
    </ol>
</template>

<style scoped>
.verlauf {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.eintrag {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

/* Was die Redaktion nach außen schreibt, liegt auf der leisen Fläche (wie auf der Statusseite des Melders). */
.eintrag--aus {
    background: var(--color-panel-soft);
}

/* Notizen: die Warnungsfläche, damit nichts Internes für etwas gehalten wird, das hinausgeht. */
.eintrag--notiz {
    border-color: var(--color-warning-soft-border);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

.eintrag__kopf {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.eintrag--notiz .eintrag__kopf {
    color: inherit;
}

.eintrag__zeit {
    margin-left: auto;
}

/* Der Betreff einer eingehenden Mail: eine ruhige Zeile über dem Text. */
.eintrag__betreff {
    margin: 0;
    color: var(--color-text);
    font-weight: bold;
    overflow-wrap: anywhere;
}

.eintrag__text {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

.eintrag__leise {
    color: var(--color-text-muted);
}

/* Der Zustellstand einer ausgehenden Mail: eine ruhige Zeile unter dem Text; nur ein Fehler färbt sich (Warnton, kein Alarm). */
.zustellung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.zustellung__stand {
    overflow-wrap: anywhere;
}

.zustellung--fehler .zustellung__stand {
    color: var(--color-danger-soft-text);
}

.ereignis {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.ereignis__text {
    padding-left: var(--space-8);
    border-left: 2px solid var(--color-divider);
    color: var(--color-text);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
</style>
