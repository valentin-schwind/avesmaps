<script setup lang="ts">
/**
 * Der Sperrhinweis des Reiseplans (WI-0038; Legacy `.route-plan-sperrung`, Entwurf 2026-09-14): ein
 * Hinweis, der VOR den Zahlen gelesen werden muss - ein Umweg von Tagen ist ohne ihn von einem
 * Rechenfehler nicht zu unterscheiden. Die Warnfarben sind Legacys „soft status surface“, in beiden
 * Themen.
 *
 * Derselbe Kasten oben, am Abzweig (Owner 14.09.2026 abends: „die warnung in eine rote box tun wie
 * oben“, dort kleiner), ohne Reisebeginn und in der Absage - ein zweites Bauteil für dieselbe Aussage
 * wäre eine zweite Rezeptur.
 */
defineProps<{
    /** Am Abzweig in der Etappe: kleiner, mit Abstand nach oben. */
    small?: boolean;
    testid?: string;
}>();
</script>

<template>
    <div class="closure" :class="{ 'closure--small': small }" role="note" :data-testid="testid">
        <span class="closure__sign" aria-hidden="true">⚠&#xFE0E;</span>
        <span class="closure__text"><slot /></span>
    </div>
</template>

<style scoped>
.closure {
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin: 0;
    padding: 5px 7px;
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
    font-size: 12px;
    line-height: 1.32;
}

.closure--small {
    margin-top: var(--space-4);
    font-size: var(--font-size-caption);
}

.closure__sign {
    flex: 0 0 auto;
    font-weight: var(--font-weight-bold);
}

.closure__text {
    min-width: 0;
}
</style>
