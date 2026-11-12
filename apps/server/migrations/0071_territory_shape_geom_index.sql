-- Ein räumlicher Index auf der Form der abgeleiteten Gebiete (`territory_shape.geom`). Bisher gab es ihn nur auf
-- `render_geom` (Migration 0055) für die Kacheln; jede Frage in Kartenkoordinaten scannte alle Formen.
--
-- Befund 2026-10-04: Der Kontext eines Orts (`pointContext`, `subjects/context.ts`) fragt die Gebiete am Punkt. Ohne Index
-- rechnet PostgreSQL den Scan über alle 3.068 Formen mit einem Parallel-Worker; dessen Start kostete auf Windows 50–230 ms
-- statt 11 ms seriell, und unter 16 gleichzeitigen Verbindungen lag das Maximum bei 1,98 s. Die Grenze der Subjects ist
-- 1 s (`SUBJECT_LIMITS.statementMs`): Unter Last antwortete `GET /api/subjects/place/<Gareth>` mit 503, alle 32 Abbrüche im
-- Journal standen an dieser einen Abfrage. Mit dem Index braucht sie rund 1 ms und keinen Worker.
--
-- Mit ihm finden auch die Gebiete einer Route (`routeTerritories`, `sh.geom && s.geom`) und die Gebiete einer Fläche
-- (`areaGeometry`) ihre Formen über den Index.
--
-- Nur ein Index: keine Kartendaten, keine Renderansicht. `IF NOT EXISTS`, damit die Migration wiederholbar bleibt.

CREATE INDEX IF NOT EXISTS territory_shape_geom_gist ON territory_shape USING GIST (geom);
