<script setup lang="ts">
/**
 * Die Kopfleiste (WI-0120 A9; Betreiber 2026-10-09 zum Blatt A8: „L1 aber ohne logo oben links - nur mit "Avesmaps Editor"
 * + pille“, AUTH-0001 §12.1). Eine schmale Leiste über der ganzen Seite, für alle: links „Avesmaps Editor“ und die Pille der
 * Umgebung, rechts das Konto mit ☰ oder „Anmelden“. Die Anwendung steht darunter (`#app` ist eine Spalte, `app.vue`).
 *
 * Auf Stage trägt die Leiste unten die Kante in der Farbe des Etiketts (ADR-0013 „Farbstreifen“), ebenso auf Production und lokal
 * (Petrol, WI-0180); ein Notzugang ist überall sichtbar (§11.2), hier als eigene Pille mit seinem Ende. Die Pille der Umgebung ist
 * für Betreiber das Umgebungsmenü (`umgebungs-menue.vue`, WI-0180).
 */
import { computed, inject, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import AvmAvatar from "../controls/avm-avatar.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import { rollenName } from "./bezeichnung";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import { oeffneMedien } from "../medien/medien-oeffnen";
import { VIEWER_CONTEXT_KEY } from "../viewer/bootstrap-viewer";
import { openAuthWindow } from "./auth-windows";
import { requestConfirmation } from "./bestaetigen";
import AppGlocke from "./app-glocke.vue";
import KontoMenue from "./konto-menue.vue";
import { authState, signOut } from "./session-state";
import UmgebungsMenue from "./umgebungs-menue.vue";
import KopfWarteschlange from "../warteschlange/kopf-warteschlange.vue";
import { stageMerkzeichen } from "./umgebungswechsel";
import { adminViewsFor } from "./verwaltung";
import { secondFactorMissing } from "./zweiter-faktor";

const session = authState.value;
const person = session.person;
const umgebung = session.environment;
/**
 * Je Fenster ein Eintrag in der Gruppe „Nur Verwaltung“ (WI-0127 SYS-15, SYS-0001 §9d.1), jeder nur mit dem Recht für mindestens
 * eine Ansicht seiner Tafel (Register `KONTENVERWALTUNG`, `SYSTEMSTEUERUNG`): Wer nur Konten pflegt, sieht die Systemsteuerung nicht.
 */
const kontenverwaltung = adminViewsFor(session.capabilities, "konten").length > 0;
const systemsteuerung = adminViewsFor(session.capabilities, "system").length > 0;
/**
 * Fehlt der zweite Faktor, steht statt der Fenster der Satz mit dem Knopf (Betreiber 2026-10-10: „2 faktoren oder keiner“).
 * Reaktiv: Nach der Bestätigung liest „Kurz bestätigen“ die Sitzung neu, und die Einträge stehen wieder da.
 */
const zweiterFaktorFehlt = computed(() => secondFactorMissing(authState.value));
/** „Medien …“ mit dem Recht der Medienverwaltung (WI-0068 P3, ab Reviewer); die Besuchervorschau nimmt es weg (`bootstrapViewer`). */
const medien = inject(VIEWER_CONTEXT_KEY, undefined)?.can("view_media_private") ?? false;
/** „Karten herunterladen …“ (WI-0280): nur mit dem Recht, also ab Admin und mit der Sonderrolle Kartograph. */
const karten = session.capabilities.includes("export_maps");
/** Folgt der Sitzung: Die Bezeichnung ändert sich im Konto, ohne dass die Leiste neu entsteht (WI-0279 E10). */
const jetzt = computed(() => authState.value.person ?? person);
const rolle = computed(() => rollenName(jetzt.value?.role ?? "", jetzt.value?.bezeichnung));
/** Steht das Menü offen? */
const offen = ref(false);
/** Das Umgebungsmenü an der Pille: nur mit `switch_environment`, also nur für Betreiber (WI-0180 §5.2). */
const darfWechseln = session.capabilities.includes("switch_environment");
/**
 * Das Merkzeichen der Stage (WI-0180, „Je Browser“): Wer hier angemeldet ist, war auf der Stage; Production liest es und gibt den
 * Eintrag „Stage“ frei. Jeder Besuch frischt es auf. Nur auf einer `stage.`-Adresse, sonst ist `stageMerkzeichen` leer. Nur
 * Betreiber sehen das Menü und behalten es; wer es von früher trägt, verliert es hier.
 */
const merkzeichen =
    person === null ? undefined : stageMerkzeichen(umgebung, globalThis.location?.hostname ?? "", darfWechseln);
if (merkzeichen !== undefined) document.cookie = merkzeichen;
const notzugangBis = computed(() =>
    person?.assurance === "recovery"
        ? new Date(person.expiresAt).toLocaleTimeString(document.documentElement.lang || undefined, {
              hour: "2-digit",
              minute: "2-digit",
          })
        : null,
);

const huelle = useTemplateRef<HTMLElement>("huelle");
const ausloeser = useTemplateRef<InstanceType<typeof AvmKnopf>>("ausloeser");

function schliessen(fokusZurueck = true): void {
    if (!offen.value) return;
    offen.value = false;
    if (fokusZurueck) ausloeser.value?.focus();
}

// Ein Klick außerhalb schließt das Menü, Escape über die Kaskade der Karte (Stufe „menus“).
function aussen(event: PointerEvent): void {
    if (huelle.value !== null && !huelle.value.contains(event.target as Node)) schliessen(false);
}
watch(offen, (jetzt) => {
    if (jetzt) document.addEventListener("pointerdown", aussen, true);
    else document.removeEventListener("pointerdown", aussen, true);
});
const kaskade = inject(ESCAPE_CASCADE_KEY, undefined);
const abmelden = kaskade?.register("menus", () => {
    if (!offen.value) return false;
    schliessen();
    return true;
});
onBeforeUnmount(() => {
    abmelden?.();
    document.removeEventListener("pointerdown", aussen, true);
});

function konto(): void {
    schliessen(false);
    openAuthWindow({ name: "konto" });
}

function zuDenKonten(): void {
    schliessen(false);
    openAuthWindow({ name: "kontenverwaltung" });
}

function zurSystemsteuerung(): void {
    schliessen(false);
    openAuthWindow({ name: "systemsteuerung" });
}

function zweitenFaktorBestaetigen(): void {
    schliessen(false);
    void requestConfirmation("second_factor");
}

function zuDenKarten(): void {
    schliessen(false);
    openAuthWindow({ name: "karten" });
}

function zuDenMedien(): void {
    schliessen(false);
    oeffneMedien();
}
</script>

<template>
    <header
        class="leiste"
        :class="{
            'leiste--stage': umgebung === 'staging',
            'leiste--production': umgebung === 'production',
            'leiste--lokal': umgebung === 'development',
        }"
        data-testid="kopfleiste"
    >
        <span class="leiste__titel avm-versalmitte einzeilig">{{ t("auth.header.title") }}</span>
        <UmgebungsMenue :umgebung="umgebung" :darf="darfWechseln" />
        <AvmPille v-if="notzugangBis !== null" ton="gefahr" testid="kopfleiste-notzugang">{{
            t("auth.recovery.badge", { time: notzugangBis })
        }}</AvmPille>
        <!-- Die Warteschlange im Kopf (WI-0230): nur mit Person, ohne eigenen Auftrag leer. -->
        <span class="leiste__luft"><KopfWarteschlange v-if="person !== null" /></span>
        <template v-if="person !== null">
            <AppGlocke />
            <span class="leiste__person">
                <AvmAvatar :kennung="person.id" :name="person.displayName" />
                <span class="leiste__name avm-versalmitte einzeilig">{{ person.displayName }}</span>
                <span class="leiste__rolle avm-versalmitte">{{ rolle }}</span>
            </span>
            <span ref="huelle" class="leiste__menue">
                <AvmKnopf
                    ref="ausloeser"
                    class="leiste__drei"
                    :aria-label="t('auth.account.open')"
                    aria-haspopup="menu"
                    :aria-expanded="offen"
                    testid="kopfleiste-menue"
                    @click="offen = !offen"
                >
                    <svg class="leiste__striche" viewBox="0 0 16 16" aria-hidden="true">
                        <path
                            d="M2 4h12M2 8h12M2 12h12"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />
                    </svg>
                </AvmKnopf>
                <div v-if="offen" class="leiste__klappe">
                    <KontoMenue
                        :person="jetzt ?? person"
                        :kontenverwaltung="kontenverwaltung"
                        :systemsteuerung="systemsteuerung"
                        :zweiter-faktor-fehlt="zweiterFaktorFehlt"
                        :medien="medien"
                        :karten="karten"
                        @konto="konto"
                        @kontenverwaltung="zuDenKonten"
                        @systemsteuerung="zurSystemsteuerung"
                        @zweiter-faktor="zweitenFaktorBestaetigen"
                        @medien="zuDenMedien"
                        @karten="zuDenKarten"
                        @abmelden="signOut()"
                        @schliessen="schliessen()"
                    />
                </div>
            </span>
        </template>
        <AvmKnopf v-else testid="kopfleiste-anmelden" @click="openAuthWindow({ name: 'anmelden' })">{{
            t("auth.signIn")
        }}</AvmKnopf>
    </header>
</template>

<style scoped>
/*
 * Eine Bedienhöhe plus Luft oben und unten; die Kante zählt mit (Blatt A8). `order: -1`: Im Dokument steht die Leiste hinter
 * der Anwendung, damit die Karte das erste Ziel der Tabulatortaste bleibt (AC14); im Bild steht sie oben.
 */
.leiste {
    order: -1;
    position: relative;
    z-index: var(--z-map-menu);
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-8);
    box-sizing: border-box;
    height: calc(var(--avm-control-h) + 2 * var(--space-4) + 2px);
    padding: 0 var(--space-10);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
}

.leiste--stage {
    border-bottom: 2px solid var(--color-warning);
}

/* Production trägt dieselbe Form wie die Stage, nur das andere Signal: Grün heißt „das ist die echte Karte“. */
.leiste--production {
    border-bottom: 2px solid var(--color-success);
}

/* Lokal in Petrol (WI-0180, Betreiber 2026-10-16: „lokale entwicklung braucht auch eine farbe“). */
.leiste--lokal {
    border-bottom: 2px solid var(--color-local);
}

.leiste__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    white-space: nowrap;
}

.leiste__luft {
    display: flex;
    flex: 1 1 auto;
    justify-content: center;
    min-width: 0;
}

.leiste__person {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.leiste__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.leiste__rolle {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.leiste__menue {
    position: relative;
}

.leiste__drei :deep(.knopf) {
    padding: 0;
    width: var(--avm-control-h);
}

.leiste__striche {
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.leiste__klappe {
    position: absolute;
    top: calc(100% + var(--space-6));
    right: 0;
}

/* Am Telefon zählt jeder Pixel: der Name weicht, Avatar und ☰ bleiben. */
@media (max-width: 600px) {
    .leiste__name,
    .leiste__rolle {
        display: none;
    }

    /* Die Uhr der Warteschlange steht am Telefon neben der Glocke und behält ihre Breite; wird es eng, kürzt der Titel (`.einzeilig`,
       mit Platz für die Unterlängen; WI-0230). */
    .leiste__luft {
        flex-shrink: 0;
        justify-content: flex-end;
    }
}
</style>
