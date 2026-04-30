import { buildSpecSchema } from "./shared";

export const planSchema = buildSpecSchema({
  kind: "plan",
  contractId: "slice-plan",
  title: "wiki slice plan frontmatter",
  constFields: {
    type: "spec",
    spec_kind: "plan",
  },
});
