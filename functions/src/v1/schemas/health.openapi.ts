import type { Registry } from "../../openapi/registry";
import { standardErrorResponses } from "../../openapi/schemas";
import { HealthResponseSchema } from "./health.schema";

export function registerHealthOpenApi(registry: Registry) {
  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["system"],
    summary: "Health check",
    responses: {
      200: {
        description: "Service is healthy",
        content: {
          "application/json": { schema: HealthResponseSchema },
        },
      },
      ...standardErrorResponses(),
    },
  });
}
