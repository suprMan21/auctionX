import { execSync } from "node:child_process";

function sh(cmd: string) {
  const display = cmd.replace(/\s+/g, " ").trim();
  const q = JSON.stringify(cmd);

  execSync(`UNMEN_SPINNER_LABEL=${JSON.stringify(display)} ./scripts/runWithSpinner.sh bash -lc ${q}`, {
    stdio: "inherit",
    env: process.env,
  });
}

export { sh };
