import type { Request, Response } from "express";
import { sendError } from "./lib/http";
import { AppError, toAppError } from "./lib/errors";
import { withRequestContext } from "./lib/requestContext";
import { healthRoute } from "./routes/health.routes";
import { echoRoute } from "./routes/echo.routes";

type Route = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: RegExp;
  handler: (req: Request, res: Response) => Promise<void>;
};

const routes: Route[] = [
  healthRoute,
  echoRoute,
];

export async function v1Router(req: Request, res: Response): Promise<void> {
  await withRequestContext(req, res, async () => {
    const method = (req.method || "GET").toUpperCase() as Route["method"];
    const urlPath = (req.path || "/").toString();

    const route = routes.find((r) => r.method === method && r.path.test(urlPath));
    if (!route) {
      throw new AppError("not_found", `No route for ${method} ${urlPath}`);
    }

    await route.handler(req, res);
  }).catch((err) => {
    const appErr = toAppError(err);
    sendError(res, appErr);
  });
}
