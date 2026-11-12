<script setup lang="ts">
/**
 * Die Fenster der Anmeldung an EINER Stelle (WI-0120 A9): `auth-windows.ts` sagt, welches offen ist; hier steht es. `app.vue`
 * hängt nur diesen Host ein, statt je Fenster einen Schalter zu führen. „Kurz bestätigen“ kann über jedem anderen stehen
 * (`bestaetigen.ts`): Es ist kein Ziel, sondern eine Rückfrage mitten in einer Handlung.
 */
import { computed } from "vue";
import AnmeldenFenster from "./anmelden-fenster.vue";
import { authWindow, closeAuthWindow, type AuthWindow } from "./auth-windows";
import BestaetigenFenster from "./bestaetigen-fenster.vue";
// Konto und Verwaltung laden erst beim Öffnen (WI-0235, `nachladen.ts`).
import {
    EinladungFenster,
    KartenExportFenster,
    KartenPaketFenster,
    KontoFenster,
    PasskeyFenster,
    PasswortFenster,
    VerwaltungFenster,
} from "../nachladen";

function schalter(name: AuthWindow["name"]) {
    return computed({
        get: () => authWindow.value?.name === name,
        set: (offen: boolean) => {
            if (!offen && authWindow.value?.name === name) closeAuthWindow();
        },
    });
}

const anmelden = schalter("anmelden");
const einladung = schalter("einladung");
const passwort = schalter("passwort");
const passkey = schalter("passkey");
const konto = schalter("konto");
const kontenverwaltung = schalter("kontenverwaltung");
const systemsteuerung = schalter("systemsteuerung");
const karten = schalter("karten");
const kartenPaket = schalter("kartenPaket");

const outcome = computed(() => {
    const current = authWindow.value;
    return current !== null && "outcome" in current ? current.outcome : undefined;
});
/** Das Token des offenen Links; die Fenster lesen es beim Öffnen. */
const token = computed(() => {
    const current = authWindow.value;
    return current !== null && "token" in current ? current.token : null;
});
/** Die Ansicht eines tiefen Links (`?verwaltung=<eintrag>`); ohne ihn die erste, die die Sitzung sieht. */
const eintrag = computed(() => {
    const current = authWindow.value;
    return current !== null && "eintrag" in current ? current.eintrag : undefined;
});
/** Der Vorgang im Kanal zu `eintrag: "claudio"` (die OPS-Nummer in der Glocke). */
const ops = computed(() => {
    const current = authWindow.value;
    return current !== null && "ops" in current ? current.ops : undefined;
});
const art = computed(() => (authWindow.value?.name === "passwort" ? authWindow.value.kind : "password_reset"));
/** Nach der Rückkehr von Discord ohne zweiten Faktor: das Anmeldefenster im zweiten Schritt. */
const zweiterFaktor = computed(() => authWindow.value?.name === "anmelden" && authWindow.value.zweiterFaktor === true);
</script>

<template>
    <AnmeldenFenster v-model:offen="anmelden" :outcome="outcome" :zweiter-faktor="zweiterFaktor" />
    <EinladungFenster v-if="einladung" v-model:offen="einladung" :token="token" :outcome="outcome" />
    <PasswortFenster v-if="passwort" v-model:offen="passwort" :kind="art" :token="token" />
    <PasskeyFenster v-if="passkey" v-model:offen="passkey" :token="token" />
    <KontoFenster v-if="konto" v-model:offen="konto" :outcome="outcome" />
    <VerwaltungFenster v-if="kontenverwaltung" v-model:offen="kontenverwaltung" tafel="konten" :eintrag="eintrag" />
    <VerwaltungFenster
        v-if="systemsteuerung"
        v-model:offen="systemsteuerung"
        tafel="system"
        :eintrag="eintrag"
        :ops="ops"
    />
    <KartenExportFenster v-if="karten" v-model:offen="karten" />
    <KartenPaketFenster v-if="kartenPaket" v-model:offen="kartenPaket" :token="token" />
    <BestaetigenFenster />
</template>
