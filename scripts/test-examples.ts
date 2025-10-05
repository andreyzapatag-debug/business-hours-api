// scripts/test-examples.ts
import fetch from "node-fetch";

type Case = {
  name: string;
  query: string;        // parte después de ? (ej: "hours=1&date=2025-10-03T22:00:00Z")
  expected?: string | null; // exact UTC expected like "2025-04-21T20:00:00Z", o null para solo mostrar
};

const BASE = "http://localhost:3000/api/business-hours";

const cases: Case[] = [
  // Rellena/ajusta las fechas concretas según tus escenarios (las de ejemplo con XX no valen)
  { name: "Ejemplo 1 - viernes 17:00 COL +1h", query: "hours=1&date=2025-10-03T22:00:00Z", expected: "2025-10-06T14:00:00Z" },
  { name: "Ejemplo 2 - sab 14:00 COL +1h", query: "hours=1&date=2025-10-04T19:00:00Z", expected: "2025-10-06T14:00:00Z" },
  { name: "Ejemplo 3 - mar 15:00 COL days=1 hours=4", query: "days=1&hours=4&date=2025-10-07T20:00:00Z", expected: "2025-10-09T15:00:00Z" },
  { name: "Ejemplo 4 - dom 18:00 COL days=1", query: "days=1&date=2025-10-05T23:00:00Z", expected: "2025-10-06T22:00:00Z" },
  { name: "Ejemplo 5 - laboral 08:00 hours=8", query: "hours=8&date=2025-10-06T13:00:00Z", expected: "2025-10-06T22:00:00Z" },
  { name: "Ejemplo 6 - laboral 08:00 days=1", query: "days=1&date=2025-10-06T13:00:00Z", expected: "2025-10-07T13:00:00Z" },
  { name: "Ejemplo 7 - 12:30 days=1 (ajusta a 12:00)", query: "days=1&date=2025-10-06T17:30:00Z", expected: "2025-10-07T17:00:00Z" },
  { name: "Ejemplo 8 - 11:30 hours=3", query: "hours=3&date=2025-10-06T16:30:00Z", expected: "2025-10-06T20:30:00Z" },
  { name: "Ejemplo 9 - feriados", query: "days=5&hours=4&date=2025-04-10T15:00:00Z", expected: "2025-04-21T20:00:00Z" },
];

async function runCase(c: Case) {
  const url = `${BASE}?${c.query}`;
  try {
    const r = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const status = r.status;
    const body = await r.json();
    const got = body.date ?? JSON.stringify(body);
    const ok = c.expected ? (got === c.expected) : null;

    console.log("-------------------------------------------------");
    console.log(`CASE: ${c.name}`);
    console.log(`URL:  ${url}`);
    console.log(`HTTP: ${status}`);
    console.log(`RESPONSE: ${JSON.stringify(body)}`);
    if (c.expected) {
      console.log(`EXPECTED: ${c.expected}`);
      console.log(ok ? "✅ MATCH" : "❌ MISMATCH");
    } else {
      console.log("EXPECTED: (not provided)");
    }
  } catch (err) {
    console.error("ERROR calling", url, err);
  }
}

(async () => {
  for (const c of cases) {
    // small delay to avoid race with holiday fetch caching
    await runCase(c);
    await new Promise((r) => setTimeout(r, 200));
  }
})();
