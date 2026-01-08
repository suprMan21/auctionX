export async function echoService(input: { requestId: string; message: string }) {
  return {
    message: input.message,
    requestId: input.requestId,
  };
}
