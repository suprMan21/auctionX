import type { Registry } from "../../openapi/registry";
import { standardErrorResponses } from "../../openapi/schemas";
import { EchoRequestSchema, EchoResponseSchema } from "./echo.schema";

export function registerEchoOpenApi(registry: Registry) {
  registry.registerPath({
    method: "post",
    path: "/echo",
    tags: ["debug"],
    summary: "Echo back a payload (debug endpoint)",
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: EchoRequestSchema },
        },
      },
    },
    responses: {
      200: {
        description: "Echo response",
        content: {
          "application/json": { schema: EchoResponseSchema },
        },
      },
      ...standardErrorResponses(),
    },
  });
}
