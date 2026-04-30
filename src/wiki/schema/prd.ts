import { buildSpecSchema } from "./shared";

export const prdSchema = buildSpecSchema({
  kind: "prd",
  contractId: "prd",
  title: "wiki prd frontmatter",
  constFields: {
    type: "spec",
    spec_kind: "prd",
  },
});
