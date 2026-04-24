import { getStateContract, type StateContractId } from "../lib/state-contract";

export type JsonSchema = {
  $schema: string;
  $id: string;
  title: string;
  type: "object";
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, { type?: string | string[]; const?: string; items?: { type: string } }>;
};

type SchemaOptions = {
  kind: string;
  contractId: StateContractId;
  title: string;
  constFields?: Record<string, string>;
};

const ARRAY_FIELDS = new Set(["source_paths", "depends_on", "claim_paths", "verification_commands"]);
const DATE_FIELDS = new Set(["created_at", "updated", "started_at", "completed_at", "claimed_at", "stale_since"]);

function fieldSchema(field: string, constValue?: string) {
  if (constValue) return { const: constValue };
  if (ARRAY_FIELDS.has(field)) return { type: "array", items: { type: "string" } };
  if (DATE_FIELDS.has(field)) return { type: "string" };
  return { type: "string" };
}

export function buildSpecSchema(options: SchemaOptions): JsonSchema {
  const contract = getStateContract(options.contractId);
  const fields = [
    ...contract.frontmatter.authored,
    ...contract.frontmatter.computed,
    ...contract.frontmatter.evidence,
  ];
  const properties = Object.fromEntries(fields.map((field) => [field, fieldSchema(field, options.constFields?.[field])]));
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://wiki-forge.dev/schema/${options.kind}.json`,
    title: options.title,
    type: "object",
    additionalProperties: true,
    required: [...contract.frontmatter.authored],
    properties,
  };
}
