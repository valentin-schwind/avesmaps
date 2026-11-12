/** Ein Fehler beim Einspielen mit einem Satz für die Oberfläche; die Datenbank ist dann unverändert (außer bei den Mediendateien nach dem Ersetzen). */
export class EinspielenFehler extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "EinspielenFehler";
        this.code = code;
    }
}
