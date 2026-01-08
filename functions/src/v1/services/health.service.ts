export async function healthService(input: { requestId: string }) {
  const version =
    process.env.API_VERSION || process.env.npm_package_version || "0.0.0";

  return {
    ok: true as const,
    service: "auction-api" as const,
    version,
    time: new Date().toISOString(),
    requestId: input.requestId,
  };
}
