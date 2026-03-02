import { z } from "zod";
import { OpenAPIRegistry, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export function createRegistry(): OpenAPIRegistry {
  return new OpenAPIRegistry();
}

export type Registry = OpenAPIRegistry;
