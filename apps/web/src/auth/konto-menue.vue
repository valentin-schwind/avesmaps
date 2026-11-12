<script setup lang="ts">
/**
 * Das Hauptmenü (Menü A, AUTH-0001 §12.1; Gestalt: Blatt A8, wie das Kontextmenü der Karte, Guide §18): der Kontoblock
 * (Avatar, Name, Rolle, Anmeldeweg), die Gruppe „Redaktion“ mit „Medien …“ (WI-0068 P3, nur mit `view_media_private`), die
 * Gruppe „Nur Verwaltung“ mit „Kontenverwaltung …“ und „Systemsteuerung …“ (WI-0127 SYS-15, SYS-0001 §9d.1; je nur mit einem Recht
 * seines Fensters; fehlt der zweite Faktor, steht dort stattdessen „Mit Passkey bestätigen …“ mit dem Satz, was fehlt) und „Abmelden“. Pfeiltasten wandern durch die Einträge, Escape
 * schließt (die Leiste gibt den Fokus zurück).
 *
 * Der Kontoblock ist selbst der Eintrag, der das Konto öffnet (Betreiber 2026-10-09: „kannst du den button hier rein tun
 * (oder das ganze Vali - Betreiber .... -ding als button machen)“); eine eigene Zeile „Konto …“ gibt es nicht mehr.
 */
import { computed, nextTick, onMounted, useTemplateRef } from "vue";
import type { SessionPerson } from "@avesmaps3d/shared";
import AvmAvatar from "../controls/avm-avatar.vue";
import { t } from "../i18n/i18n";
import { rollenName } from "./bezeichnung";

const props = defineProps<{
    person: SessionPerson;
    /** Ein Recht für mindestens eine Ansicht der Kontenverwaltung bzw. der Systemsteuerung. */
    kontenverwaltung: boolean;
    systemsteuerung: boolean;
    /**
     * Verwaltungsrechte ohne zweiten Faktor: statt der zwei Fenster der Satz, was fehlt, mit dem Knopf dazu (2026-10-10). Der zweite
     * Faktor ist allein der Passkey (Betreiber 2026-10-10: „4. B“); fehlt auch der, erklärt „Kurz bestätigen“ den Weg zum ersten.
     */
    zweiterFaktorFehlt?: boolean | undefined;
    medien?: boolean | undefined;
    /** „Karten herunterladen …“ mit `export_maps` (WI-0280: ab Admin und mit der Sonderrolle Kartograph). */
    karten?: boolean | undefined;
}>();
const emit = defineEmits<{
    konto: [];
    kontenverwaltung: [];
    systemsteuerung: [];
    zweiterFaktor: [];
    medien: [];
    karten: [];
    abmelden: [];
    schliessen: [];
}>();

const menue = useTemplateRef<HTMLElement>("menue");

const rolle = computed(() => rollenName(props.person.role, props.person.bezeichnung));
const weg = computed(() => t(`auth.menu.signedIn.${props.person.sessionMethod}`));
/** Der Name des Eintrags für Vorleser: die Handlung zuerst, dann wer. */
const kontoName = computed(() => `${t("auth.menu.account")} ${props.person.displayName}, ${rolle.value}, ${weg.value}`);

function eintraege(): HTMLButtonElement[] {
    return [...(menue.value?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
}

function wandern(schritt: number): void {
    const liste = eintraege();
    const jetzt = liste.indexOf(document.activeElement as HTMLButtonElement);
    const ziel = liste[(jetzt + schritt + liste.length) % liste.length];
    ziel?.focus();
}

function taste(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") wandern(1);
    else if (event.key === "ArrowUp") wandern(-1);
    else if (event.key === "Home") eintraege()[0]?.focus();
    else if (event.key === "End") eintraege().at(-1)?.focus();
    else if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.stopPropagation();
        emit("schliessen");
        return;
    } else return;
    event.preventDefault();
}

onMounted(() => void nextTick(() => eintraege()[0]?.focus()));
</script>

<template>
    <div
        ref="menue"
        class="menue"
        role="menu"
        :aria-label="t('auth.menu.label')"
        data-testid="hauptmenue"
        @keydown="taste"
    >
        <button
            type="button"
            class="menue__konto"
            role="menuitem"
            data-testid="menue-konto"
            :aria-label="kontoName"
            @click="emit('konto')"
        >
            <AvmAvatar :kennung="person.id" :name="person.displayName" groesse="gross" />
            <span class="menue__person">
                <span class="menue__name einzeilig">{{ person.displayName }}</span>
                <span class="menue__rolle">{{ rolle }}</span>
                <span class="menue__weg">{{ weg }}</span>
            </span>
        </button>
        <div v-if="medien || karten" class="menue__gruppe" role="group" :aria-label="t('auth.menu.editorialGroup')">
            <span class="menue__titel" aria-hidden="true">{{ t("auth.menu.editorialGroup") }}</span>
            <button
                v-if="medien"
                type="button"
                class="menue__eintrag menue__eintrag--zweizeilig"
                role="menuitem"
                data-testid="menue-medien"
                @click="emit('medien')"
            >
                <span>{{ t("auth.menu.media") }}</span>
                <span class="menue__zweite">{{ t("auth.menu.mediaHint") }}</span>
            </button>
            <button
                v-if="karten"
                type="button"
                class="menue__eintrag menue__eintrag--zweizeilig"
                role="menuitem"
                data-testid="menue-karten"
                @click="emit('karten')"
            >
                <span>{{ t("auth.menu.maps") }}</span>
                <span class="menue__zweite">{{ t("auth.menu.mapsHint") }}</span>
            </button>
        </div>
        <div
            v-if="kontenverwaltung || systemsteuerung"
            class="menue__gruppe"
            role="group"
            :aria-label="t('auth.menu.adminGroup')"
        >
            <span class="menue__titel" aria-hidden="true">{{ t("auth.menu.adminGroup") }}</span>
            <button
                v-if="zweiterFaktorFehlt"
                type="button"
                class="menue__eintrag menue__eintrag--zweizeilig"
                role="menuitem"
                data-testid="menue-zweiter-faktor"
                @click="emit('zweiterFaktor')"
            >
                <span>{{ t("auth.secondFactor.withPasskey") }}</span>
                <span class="menue__zweite">{{ t("auth.secondFactor.missing") }}</span>
            </button>
            <template v-else>
                <button
                    v-if="kontenverwaltung"
                    type="button"
                    class="menue__eintrag menue__eintrag--zweizeilig"
                    role="menuitem"
                    data-testid="menue-kontenverwaltung"
                    @click="emit('kontenverwaltung')"
                >
                    <span>{{ t("auth.menu.accounts") }}</span>
                    <span class="menue__zweite">{{ t("auth.menu.accountsHint") }}</span>
                </button>
                <button
                    v-if="systemsteuerung"
                    type="button"
                    class="menue__eintrag menue__eintrag--zweizeilig"
                    role="menuitem"
                    data-testid="menue-systemsteuerung"
                    @click="emit('systemsteuerung')"
                >
                    <span>{{ t("auth.menu.system") }}</span>
                    <span class="menue__zweite">{{ t("auth.menu.systemHint") }}</span>
                </button>
            </template>
        </div>
        <div class="menue__gruppe" role="none">
            <button
                type="button"
                class="menue__eintrag"
                role="menuitem"
                data-testid="menue-abmelden"
                @click="emit('abmelden')"
            >
                {{ t("auth.menu.signOut") }}
            </button>
        </div>
    </div>
</template>

<style scoped>
.menue {
    box-sizing: border-box;
    width: max-content;
    min-width: calc(var(--avesmaps-infopanel-width) * 0.65);
    max-width: calc(100vw - 2 * var(--space-10));
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
    text-align: left;
}

/* Der Kontoblock ist ein Knopf: dieselbe Fläche beim Zeigen und derselbe Fokusring wie die Einträge darunter. */
.menue__konto {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-4) var(--space-6) var(--space-6);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.menue__konto:hover,
.menue__konto:focus-visible {
    background: var(--color-hover-wash);
}

.menue__konto:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.menue__person {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.menue__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.menue__rolle {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.menue__weg {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Der Trenner im Menü ist eingerückt (Guide §5 „Linien“: ein schwebendes Menü ist keine Leseseite). */
.menue__gruppe {
    display: flex;
    flex-direction: column;
    margin: var(--space-2) var(--space-4) 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-divider);
}

.menue__titel {
    padding: var(--space-4) var(--space-6) 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.menue__eintrag {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    min-height: calc(var(--avm-control-h) + var(--space-2));
    margin: 0 calc(-1 * var(--space-4));
    padding: var(--space-4) var(--space-10);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

.menue__eintrag:hover,
.menue__eintrag:focus-visible {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.menue__eintrag:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.menue__zweite {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

@media (prefers-reduced-motion: reduce) {
    .menue__konto,
    .menue__eintrag {
        transition: none;
    }
}
</style>
