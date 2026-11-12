# Beitragen

*English: Pull requests against the `avesmaps3d` branch are welcome. They are not merged here; the change is carried over by hand into the
private working repository and appears with the next export. Contributions to the code are accepted under the MIT license.*

## Wie ein Beitrag läuft

Dieser Zweig ist eine **Einbahn-Ausgabe** aus dem Arbeitsrepository von Avesmaps3D (siehe [`README.md`](README.md)). Deshalb:

1. Pull Request gegen den Zweig **`avesmaps3d`** stellen (nicht gegen `master`, dort liegt der alte Stand).
2. Die Änderung wird gelesen und, wenn sie passt, von Hand ins Arbeitsrepository übernommen, angepasst an den dortigen Stand.
3. Der Pull Request wird danach **geschlossen, nicht gemergt**, mit einem Hinweis, in welcher Ausgabe die Änderung steckt. Mit der nächsten
   Ausgabe ist sie in diesem Zweig.

Bis zur nächsten Ausgabe kann es dauern: Ausgegeben wird je Release von [avesmaps.de](https://avesmaps.de/).

## Was gut passt

- Fehlerbehebungen im Code, mit einem Test, der ohne die Behebung fehlschlägt
- kleine, abgegrenzte Verbesserungen; bei Größerem bitte vorher ein Issue, damit keine Arbeit umsonst ist
- Hinweise auf unklare oder falsche Stellen in [`docs/schnittstellen/`](docs/schnittstellen/)

## Was nicht über GitHub läuft

- **Fehler auf der Karte** (falscher Ort, fehlender Weg, falsche Grenze): direkt auf der Karte über „Hier etwas melden“ oder „Änderungen
  vorschlagen“, oder mit `/bug` und `/idee` auf dem Discord-Server. Die Kartendaten liegen nicht in diesem Zweig.
- **Sicherheitslücken:** vertraulich, siehe [`SECURITY.md`](SECURITY.md).
- **DSA-Material** (Karten, Texte, Bilder aus Publikationen): nur, wenn die Rechte dafür geklärt sind (siehe [`LEGAL.md`](LEGAL.md)).

## Rechte an Beiträgen

Beiträge zum Programmcode stehen unter der MIT-Lizenz ([`LICENSE`](LICENSE)), wie der übrige Code. Mit dem Pull Request bestätigt, wer
beiträgt, dass der Beitrag ein eigenes Werk ist oder unter einer verträglichen Lizenz steht.

## Stil

- TypeScript im strikten Modus, ESM, Node.js 24 oder neuer.
- Formatierung mit Prettier, Prüfung mit ESLint und dem Typcheck: `npm run format:check`, `npm run lint`, `npm run typecheck`, dazu `npm test`.
- Kommentare und Dokumentation sind auf Deutsch; ein Beitrag auf Englisch ist trotzdem willkommen.
- Kommentare sagen, **warum** etwas so ist, nicht, was die nächste Zeile tut.
