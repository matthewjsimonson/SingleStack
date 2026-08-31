// The web app mirrors the model policy so the cost dial can preview an
// implication without a round trip (web/lib/aiPolicy.ts says so itself, and
// _shared/ai_policy.ts is authoritative at runtime). A mirror only helps while
// it agrees: a model refresh already renamed the keys in one copy and left the
// other's prices and labels describing the models they replaced, which would
// have over-reported Sonnet spend by 50% in the UI.
//
// These tests compare the two directly, so the next refresh that touches one
// and forgets the other fails here instead of shipping.
import { FLOORS, MODELS, PRESET_MATRIX, TASK_TIER } from "./ai_policy.ts";
import { PRICING } from "./ai_usage.ts";
import {
  FLOORS as WEB_FLOORS,
  MODEL_LABEL as WEB_LABEL,
  MODELS as WEB_MODELS,
  PRESET_MATRIX as WEB_MATRIX,
  PRICING as WEB_PRICING,
  TASK_TIER as WEB_TIER,
} from "../../../web/lib/aiPolicy.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? msg + ": " : ""}expected ${b}, got ${a}`);
}

Deno.test("mirror: MODELS match", () => {
  assertEquals(WEB_MODELS, MODELS);
});

Deno.test("mirror: PRICING matches for every model", () => {
  assertEquals(
    Object.keys(WEB_PRICING).sort(),
    Object.keys(PRICING).sort(),
    "the two price tables cover different models",
  );
  for (const id of Object.keys(PRICING)) {
    assertEquals(WEB_PRICING[id], PRICING[id], `price for ${id}`);
  }
});

Deno.test("mirror: every priced model has a display label", () => {
  for (const id of Object.keys(PRICING)) {
    if (!WEB_LABEL[id]) throw new Error(`no MODEL_LABEL for ${id} — the UI would show a raw model id`);
  }
});

Deno.test("mirror: a label never names a different model than its id", () => {
  // "claude-sonnet-5" labelled "Sonnet 4.6" is the exact failure this catches.
  const family = (id: string) => id.replace(/^claude-/, "").replace(/-/g, " ");
  for (const [id, label] of Object.entries(WEB_LABEL)) {
    const want = family(id).split(" ");           // e.g. ["sonnet","5"] / ["opus","4","8"]
    const got = label.toLowerCase().replace(/\./g, " ").split(/\s+/);
    assertEquals(got.join(" "), want.join(" "), `label "${label}" does not describe ${id}`);
  }
});

Deno.test("mirror: TASK_TIER matches", () => {
  assertEquals(Object.keys(WEB_TIER).sort(), Object.keys(TASK_TIER).sort(), "task lists differ");
  for (const t of Object.keys(TASK_TIER)) assertEquals(WEB_TIER[t], TASK_TIER[t], `tier for ${t}`);
});

Deno.test("mirror: FLOORS and PRESET_MATRIX match", () => {
  assertEquals(WEB_FLOORS, FLOORS);
  assertEquals(WEB_MATRIX, PRESET_MATRIX);
});

Deno.test("policy: every model the matrix or floors can select is priced", () => {
  const selectable = new Set<string>(Object.values(MODELS));
  for (const preset of Object.values(PRESET_MATRIX)) {
    for (const lever of Object.values(preset)) selectable.add(lever.model);
  }
  for (const lever of Object.values(FLOORS)) selectable.add(lever.model);
  for (const id of selectable) {
    if (!PRICING[id]) throw new Error(`${id} is selectable but has no price — its runs would log cost null`);
  }
});
