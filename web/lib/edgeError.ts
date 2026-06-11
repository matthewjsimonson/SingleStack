// Turn a supabase functions.invoke() error into a message that actually says
// what went wrong. supabase-js wraps three cases:
//   • FunctionsHttpError — the function ran and returned a non-2xx; the real
//     message is in the JSON body (error.context is the Response).
//   • FunctionsFetchError — "Failed to send a request…": the request never
//     reached the function (not deployed / still deploying / CORS / timeout).
//   • FunctionsRelayError — the gateway relay failed.
// deno-lint-ignore no-explicit-any
export async function edgeErrorMessage(error: any, fnName: string): Promise<string> {
  // A non-2xx from the function carries its JSON { error } body.
  try {
    if (error?.context && typeof error.context.json === "function") {
      const body = await error.context.json();
      if (body?.error) return String(body.error);
    }
  } catch { /* body wasn't JSON — fall through */ }

  const msg = String(error?.message ?? "");
  if (error?.name === "FunctionsFetchError" || /failed to send a request/i.test(msg)) {
    return `Couldn't reach the “${fnName}” function — the request never arrived. It may still be deploying, isn't deployed, or the call timed out. Check Supabase → Edge Functions → ${fnName} → Logs (no log = it didn't reach the function), and that the deploy's “Deploy Edge Functions” step succeeded.`;
  }
  if (error?.name === "FunctionsRelayError") {
    return `The “${fnName}” function relay failed — try again; if it persists, redeploy the function.`;
  }
  return msg || `The “${fnName}” function failed.`;
}
