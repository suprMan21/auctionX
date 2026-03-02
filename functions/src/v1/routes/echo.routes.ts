import type { Request, Response } from "express";
import { echoHandler } from "../handlers/echo.handler";

export const echoRoute = {
  method: "POST" as const,
  path: /^\/v1\/echo$/,
  handler: async (req: Request, res: Response) => echoHandler(req, res),
};
