import { watch } from "vue";
import { reisebilderStand } from "../medien/medien-oeffnen";
import { inhaltsstand } from "../system/inhaltsstand";
import { reisebilder } from "./reisebilder-zustand";

/**
 * Neue Reisebilder erscheinen von selbst (WI-0272; Vali 2026-11-02: „ja andere besucher sollen neu freigegebene bilder ohne zutun sehen - aber es soll kein popup oder so kommen, einfach leise das bild in die
 * photobox hinzufügen“). Der Stand der Reisebilder fährt im vorhandenen Takt von `GET /api/content-state` mit (60 s, und sobald die Seite wieder sichtbar wird). Ändert er sich, fragt die Karte neu, und der
 * offene Kopf eines Ortes liest neu. Kein Hinweis, kein neuer Dienst, kein zweiter Takt.
 *
 * Wer selbst freigibt, wartet nicht auf den Takt (Vali: „was cool wär wenn gleich nach freigabe das bild erscheinen würde“): Nach jeder Operation an einer Reisebild-Einreichung liest die Seite den Stand sofort.
 */
export function folgeReisebildStand(optionen: { readonly kopfNeu: () => void }): () => void {
    // Startet den Takt: Auf einer Karte ohne offenes Panel fragt sonst vielleicht noch niemand.
    inhaltsstand.aus();
    const stand = watch(
        () => inhaltsstand.stand.value.reisebilder,
        (neu, alt) => {
            if (alt === undefined || neu === undefined || neu === alt) return;
            reisebilder.frisch();
            optionen.kopfNeu();
        },
    );
    const eigene = watch(reisebilderStand, () => void inhaltsstand.lies());
    return () => {
        stand();
        eigene();
    };
}
