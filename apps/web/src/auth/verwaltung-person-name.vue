<script setup lang="ts">
/**
 * Eine Person in der Verwaltung (WI-0120 A10): Avatar, Name, darunter die Anmeldewege („Discord · Passwort“; AUTH-0001 §12.4
 * statt der Spalte „Discord-Name“), das Etikett „eigenes Konto“. Der Name öffnet das Detail. Gesperrt oder ohne Zugang steht
 * der Name gedämpft (Mockup).
 */
import type { AdminPerson } from "@avesmaps3d/shared";
import AvmAvatar from "../controls/avm-avatar.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import { methodsText } from "./verwaltung-text";

defineProps<{ person: AdminPerson }>();
const emit = defineEmits<{ oeffnen: [] }>();
</script>

<template>
    <span class="person" :class="{ 'is-still': person.status !== 'active' || person.access !== 'active' }">
        <AvmAvatar :kennung="person.id" :name="person.displayName" />
        <span class="person__wer">
            <button
                type="button"
                class="person__name"
                :title="t('admin.people.details')"
                :data-testid="`person-oeffnen-${person.id}`"
                @click="emit('oeffnen')"
            >
                {{ person.displayName }}
            </button>
            <span class="person__wege einzeilig">{{ methodsText(person.methods, person.passkeyCount) }}</span>
        </span>
        <AvmPille v-if="person.self" ton="neutral">{{ t("admin.people.own") }}</AvmPille>
    </span>
</template>

<style scoped>
.person {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

/*
 * Name und Anmeldewege untereinander. `.einzeilig` steht nur an der UNTEREN Zeile: Sein Unterlängen-Ausgleich (ein negativer Rand
 * unten) zöge sonst die zweite Zeile in die erste.
 */
.person__wer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    white-space: nowrap;
}

.person__name {
    overflow: hidden;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-strong);
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    text-align: left;
    cursor: pointer;
}

.person__name:hover {
    color: var(--color-link);
    text-decoration: underline;
}

.person__name:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.person.is-still .person__name {
    color: var(--color-text-muted);
}

.person__wege {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
}
</style>
