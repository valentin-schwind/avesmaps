<script setup lang="ts">
import type { DiscordZustellung } from "@avesmaps3d/shared";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import { t } from "../i18n/i18n";
import { kreisVon } from "./discord";
import { tagText } from "./pflege";

/**
 * Eine Zustellung im Sendearchiv des Reiters „Discord“ (WI-0255): Kreis, Kopf mit Tag, Zustand, Message-ID und Versuchen, die
 * Diagnose bei einem Fehlschlag und der Inhalt, genau wie er hinausging, in der Klappbox des Hauses. „Wiederholen“ nur, wo der Server die
 * Zustellung für wiederholbar hält (heute, aktueller Kanal, nach einem Fehlschlag) und das Recht da ist.
 */
const props = defineProps<{
    zustellung: DiscordZustellung;
    darf: boolean;
    gesperrt: boolean;
}>();
const emit = defineEmits<{ wiederholen: [] }>();
</script>

<template>
    <li class="zeile" :data-testid="`discord-zustellung-${String(props.zustellung.id)}`">
        <AvmKreis :fuellung="kreisVon(props.zustellung)" :name="t(`admin.discord.status.${props.zustellung.status}`)" />
        <div class="zeile__rumpf">
            <div class="zeile__kopf">
                <span class="zeile__tag">{{ tagText(props.zustellung.tag) }}</span>
                <span class="zeile__status">{{ t(`admin.discord.status.${props.zustellung.status}`) }}</span>
                <span v-if="props.zustellung.messageId">{{
                    t("admin.discord.zeile.nachricht", { id: props.zustellung.messageId })
                }}</span>
                <span>{{ t("admin.discord.zeile.versuche", { anzahl: props.zustellung.versuche }) }}</span>
                <span v-if="props.zustellung.ausgeloest === 'hand'">{{ t("admin.discord.zeile.hand") }}</span>
                <span v-if="props.zustellung.formulierung === 'modell'">{{ t("admin.discord.zeile.modell") }}</span>
            </div>
            <p v-if="props.zustellung.fehler" class="zeile__fehler" data-testid="discord-zustellung-fehler">
                {{ props.zustellung.fehler }}
            </p>
            <AvmDisclosure :label="t('admin.discord.zeile.inhalt')">
                <pre class="zeile__text">{{ props.zustellung.text }}</pre>
            </AvmDisclosure>
            <span v-if="props.darf && props.zustellung.wiederholbar" class="zeile__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    art="gefuellt"
                    :gesperrt="props.gesperrt ? '' : undefined"
                    testid="discord-wiederholen"
                    @click="emit('wiederholen')"
                    >{{ t("admin.discord.zeile.wiederholen") }}</AvmKnopf
                >
            </span>
        </div>
    </li>
</template>

<style scoped>
.zeile {
    display: flex;
    gap: var(--space-6);
    align-items: flex-start;
    list-style: none;
}

.zeile__rumpf {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.zeile__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.zeile__tag {
    font-variant-numeric: tabular-nums;
}

.zeile__status {
    color: var(--color-text-strong);
}

.zeile__fehler {
    margin: 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.zeile__text {
    margin: 0;
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.zeile__knoepfe {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-2);
}
</style>
