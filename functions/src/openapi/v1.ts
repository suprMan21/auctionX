import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { createRegistry, type Registry } from "./registry";
import { registerSharedSchemas } from "./schemas";

import { registerHealthOpenApi } from "../v1/schemas/health.openapi";
import { registerEchoOpenApi } from "../v1/schemas/echo.openapi";

function registerV1Paths(registry: Registry) {
  registerSharedSchemas(registry);

  registerHealthOpenApi(registry);
  registerEchoOpenApi(registry);
}

export function buildV1OpenApiDocument() {
  const registry = createRegistry();
  registerV1Paths(registry);

  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Unmentionables API",
      version: "1.0.0",
    },
    servers: [{ url: "/v1" }],
  });
}
