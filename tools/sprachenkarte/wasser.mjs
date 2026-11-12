// Nur lesend: Wasserflächen (see, meer) als GeoJSON aus der Datenbank von DATABASE_URL (ein SELECT, keine Schreibzugriffe).
// Aufruf, aus der Wurzel des Repositoriums:
//   node --env-file-if-exists=.env tools/sprachenkarte/wasser.mjs <arbeitsordner>/wasser.geojson
// s1-ableitung.py schneidet die Sprachflächen gegen das Meer daraus (T-4: nur `meer`, nie die Seen).
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const ausgabe = process.argv[2];
if (!ausgabe || !process.env.DATABASE_URL) {
    console.error("usage: DATABASE_URL=… node tools/sprachenkarte/wasser.mjs <ausgabe.geojson>");
    process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
    const rows = await sql`
        SELECT r.region_type AS typ, count(*)::int AS n, ST_AsGeoJSON(ST_UnaryUnion(ST_Collect(ST_Buffer(ST_MakeValid(a.geom), 0))), 3) AS geo
        FROM region r JOIN region_area a ON a.region_id = r.id AND a.is_active
        WHERE r.is_active AND r.region_type IN ('see', 'meer') GROUP BY r.region_type`;
    for (const z of rows) console.log(z.typ, z.n, z.geo.length);
    writeFileSync(
        ausgabe,
        JSON.stringify({
            type: "FeatureCollection",
            features: rows.map((z) => ({ type: "Feature", properties: { typ: z.typ }, geometry: JSON.parse(z.geo) })),
        }),
    );
} finally {
    await sql.end();
}
