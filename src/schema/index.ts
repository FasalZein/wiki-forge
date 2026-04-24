import { requireValue } from "../cli-shared";
import { featureSchema } from "./feature";
import { planSchema } from "./plan";
import { prdSchema } from "./prd";
import { sliceHubSchema } from "./slice-hub";
import { testPlanSchema } from "./test-plan";
import type { JsonSchema } from "./shared";

export const SPEC_SCHEMA_KINDS = ["slice-hub", "plan", "test-plan", "prd", "feature"] as const;
export type SpecSchemaKind = (typeof SPEC_SCHEMA_KINDS)[number];

const SCHEMAS: Record<SpecSchemaKind, JsonSchema> = {
  "slice-hub": sliceHubSchema,
  plan: planSchema,
  "test-plan": testPlanSchema,
  prd: prdSchema,
  feature: featureSchema,
};

export function schemaCommand(args: string[]) {
  if (args.includes("--list")) {
    console.log(SPEC_SCHEMA_KINDS.join("\n"));
    return;
  }

  const kind = args.find((arg) => !arg.startsWith("--"));
  requireValue(kind, "schema-kind");
  if (!(kind in SCHEMAS)) throw new Error(`unknown schema kind: ${kind}`);
  console.log(JSON.stringify(SCHEMAS[kind as SpecSchemaKind], null, 2));
}
