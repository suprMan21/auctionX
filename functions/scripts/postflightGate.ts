// TODO: unify command execution between preflight/postflight (consider using shared sh() shim + runWithSpinner for step commands)
import { spawnSync } from "node:child_process";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

type Step = {
  name: string;
  cmd: string;
  args: string[];
  mustInclude: string[];
};

function runStep(step: Step) {
  const startedAt = Date.now();
  const res = spawnSync(step.cmd, step.args, {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });

  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  const combined = `${stdout}\n${stderr}`.trim();

  process.stdout.write(combined.length ? combined + "\n" : "");

  for (const needle of step.mustInclude) {
    if (!combined.includes(needle)) {
      throw new Error(`[postflight] step "${step.name}" missing required marker: ${needle}`);
    }
  }

  if (res.status !== 0) {
    throw new Error(`[postflight] step "${step.name}" exited non-zero: ${res.status}`);
  }

  const durationMs = Date.now() - startedAt;
  process.stdout.write(`[postflight] step "${step.name}" OK (${durationMs}ms)\n`);
}

function main() {
  const steps: Step[] = [
    {
      name: "build",
      cmd: "npm",
      args: ["run", "build"],
      mustInclude: [],
    },
    {
      name: "preflight",
      cmd: "npx",
      args: ["ts-node", "./scripts/preflightGate.ts"],
      mustInclude: ["PREFLIGHT GATE: PASS"],
    },
    {
      name: "settlement",
      cmd: "npx",
      args: ["ts-node", "./scripts/settlementGate.ts"],
      mustInclude: ["SETTLEMENT GATE: PASS"],
    },
    {
      name: "payment",
      cmd: "npx",
      args: ["ts-node", "./scripts/paymentGate.ts"],
      mustInclude: ["PAYMENT GATE: PASS"],
    },
    {
      name: "dispute",
      cmd: "npx",
      args: ["ts-node", "./scripts/disputeGate.ts"],
      mustInclude: ["DISPUTE GATE: PASS"],
    },
    {
      name: "payout",
      cmd: "npx",
      args: ["ts-node", "./scripts/payoutGate.ts"],
      mustInclude: ["PAYOUT GATE: PASS"],
    },
  ];

  process.stdout.write("============================================================\n");
  process.stdout.write("POSTFLIGHT GATE\n");
  process.stdout.write("============================================================\n");

  for (const step of steps) runStep(step);

  process.stdout.write("============================================================\n");
  process.stdout.write("POSTFLIGHT GATE: PASS\n");
  process.stdout.write("============================================================\n");
  process.stdout.write(JSON.stringify({ ok: true }, null, 2) + "\n");
}

main();
