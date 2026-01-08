import fs from "node:fs";
import path from "node:path";
import { buildV1OpenApiDocument } from "./v1";

const doc = buildV1OpenApiDocument();

const outPath = path.resolve(process.cwd(), "openapi", "v1.openapi.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf8");

process.stdout.write(outPath + "\n");
