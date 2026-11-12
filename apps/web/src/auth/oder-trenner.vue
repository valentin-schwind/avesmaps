<script setup lang="ts">
/** „oder“ zwischen zwei Linien (Blatt A8): der Trenner des Hauses, in der Mitte unterbrochen; zwischen zwei Wegen der Anmeldung. */
import { t } from "../i18n/i18n";
</script>

<template>
    <div class="oder">
        <span class="avm-versalmitte">{{ t("auth.login.or") }}</span>
    </div>
</template>

<style scoped>
.oder {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.oder::before,
.oder::after {
    flex: 1 1 auto;
    border-top: 1px solid var(--color-divider);
    content: "";
}
</style>
