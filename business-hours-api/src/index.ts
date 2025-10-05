// src/index.ts
/* eslint-disable @typescript-eslint/no-var-requires */
const express = require("express");
const { computeBusinessDate } = require("./lib/business");

// Tipos (solo tipos importados)
import type { Request, Response } from "express";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

/**
 * Response types
 */
type SuccessResponse = { date: string };
type ErrorResponse = { error: string; message: string };

function error400(res: Response, message: string) {
  const body: ErrorResponse = { error: "InvalidParameters", message };
  res.status(400).type("application/json").json(body);
}

function error503(res: Response, message: string) {
  const body: ErrorResponse = { error: "ServiceUnavailable", message };
  res.status(503).type("application/json").json(body);
}

function error500(res: Response, message: string) {
  const body: ErrorResponse = { error: "InternalError", message };
  res.status(500).type("application/json").json(body);
}

/**
 * Endpoint: GET /api/business-hours
 * Query:
 *  - days (optional, integer >=0)
 *  - hours (optional, integer >=0)
 *  - date (optional, ISO 8601 UTC with Z)
 *
 * If neither days nor hours provided -> 400
 */
app.get("/api/business-hours", async (req: Request, res: Response) => {
  try {
    const q = req.query;

    const rawDays = q.days as string | undefined;
    const rawHours = q.hours as string | undefined;
    const rawDate = q.date as string | undefined;

    const days = rawDays !== undefined ? Number(rawDays) : 0;
    const hours = rawHours !== undefined ? Number(rawHours) : 0;

    // Validate presence
    if ((rawDays === undefined || rawDays === "") && (rawHours === undefined || rawHours === "")) {
      return error400(res, "Se requiere 'days' o 'hours' (entero positivo).");
    }

    // Validate numeric and integer >=0
    if (!Number.isInteger(days) || days < 0) {
      return error400(res, "'days' debe ser un entero positivo.");
    }
    if (!Number.isInteger(hours) || hours < 0) {
      return error400(res, "'hours' debe ser un entero positivo.");
    }

    // Validate date format if provided (must be ISO with Z)
    if (rawDate !== undefined) {
      // Quick check: must end with Z
      if (typeof rawDate !== "string" || !rawDate.endsWith("Z")) {
        return error400(res, "'date' debe ser ISO 8601 en UTC con sufijo Z.");
      }
      // computeBusinessDate will validate properly
    }

    // Compute result (returns DateTime in UTC)
    let result;
    try {
      result = await computeBusinessDate(rawDate ?? null, days, hours); // Luxon DateTime (zone utc)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "InvalidDate") {
        return error400(res, "'date' no es un ISO UTC válido.");
      }
      // if fetch failed (holiday fetch), computeBusinessDate will throw; interpret as service unavailable
      return error503(res, "No fue posible obtener el catálogo de días festivos.");
    }

    // Format result exactly: ISO 8601 with Z, no millisecond suppression required in spec but examples vary.
    // We will suppress milliseconds to match examples like "2025-08-01T14:00:00Z"
    const dateIso: string = result.toISO({ suppressMilliseconds: true });

    const body: SuccessResponse = { date: dateIso };
    res.status(200).type("application/json").json(body);
  } catch (err: unknown) {
    if (err instanceof Error) {
      return error500(res, err.message);
    }
    return error500(res, "Error interno");
  }
});

// Optional root health
app.get("/", (_req: Request, res: Response) => {
  res.status(200).type("application/json").json({ message: "Business-hours API running" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening at http://localhost:${PORT}`);
});
