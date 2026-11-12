# Sicherheitslücken melden

*English: Please report vulnerabilities privately (see below), not as a public issue. Reports in English are welcome.*

Wer eine Sicherheitslücke in Avesmaps3D oder auf [avesmaps.de](https://avesmaps.de/) findet, meldet sie bitte **nicht öffentlich** als Issue,
Pull Request oder im Discord, sondern vertraulich:

- über **„Report a vulnerability“** im Reiter „Security“ dieses Repositorys, oder
- per Mail an `info` at `avesmaps.de` mit dem Betreff „Sicherheit“.

Hilfreich sind: betroffene Adresse oder Datei, Schritte zum Nachstellen, was sich damit erreichen lässt, und ob die Lücke schon anderen bekannt
ist.

## Was dazugehört

- der Quelltext in diesem Zweig (`avesmaps3d`) und die Anwendung auf `avesmaps.de`
- besonders: Anmeldung und Rechte, Schreibwege in die Kartendaten, Uploads, die öffentlichen Schnittstellen unter `/api/`

Nicht dazu gehören: der alte Stand im Zweig `master` (nur noch Notbetrieb), fremde Dienste (GitHub, Discord, Wiki Aventurica) und Berichte von
Scannern ohne nachgestellten Fall.

## Bitte beim Prüfen

- keine Last erzeugen (keine Massenabfragen, kein Durchprobieren von Zugängen), keine Daten anderer ansehen, ändern oder löschen
- nur eigene Konten und eigene Einreichungen verwenden
- nichts veröffentlichen, bevor die Lücke behoben ist

## Was danach passiert

Avesmaps ist ein Freizeitprojekt ohne Bereitschaftsdienst. Eine Meldung wird so bald wie möglich bestätigt, meist innerhalb weniger Tage;
behoben wird sie im Arbeitsrepository und erscheint mit der nächsten Ausgabe in diesem Zweig. Wer möchte, wird im Commit oder in den
Neuigkeiten genannt. Eine Belohnung gibt es nicht.
