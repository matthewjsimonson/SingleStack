# Testing the edge functions

Edge functions run on **Deno** (not Node). Their logic is tested with `deno test`,
which executes the **real modules in the real runtime** — the result is an exit
code, so correctness never depends on eyeballing output.

```bash
# all shared-module tests (SSRF guard, injection screen, synthesis logic)
deno test supabase/functions/_shared/

# one suite
deno test supabase/functions/_shared/security.test.ts
deno test supabase/functions/_shared/synthesis.test.ts
```

## What's covered
- `security.ts` — SSRF guard (https-only; private/loopback/link-local/metadata;
  **numeric-encoding bypasses** decimal/hex/octal/short-form), the deterministic
  injection screen, and the untrusted-data wrapper.
- `synthesis.ts` — `inferScope` (company-wide / single-line / cross-product
  derivation) and `partitionByLine` / `passOrder` (the seam for the per-product
  synthesis pass).

## Convention
Keep ingestion/security/synthesis **logic** in importable `_shared/*.ts` modules
with co-located `*.test.ts`, and keep `index.ts` as the thin HTTP+DB shell. Pure,
testable logic on one side; the un-unit-testable model/DB I/O on the other. New
logic in an edge function should land with a `deno test` that covers it.
