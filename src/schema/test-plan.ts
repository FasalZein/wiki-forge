import { buildSpecSchema } from "./shared";

export const testPlanSchema = buildSpecSchema({
  kind: "test-plan",
  contractId: "slice-test-plan",
  title: "wiki slice test-plan frontmatter",
  constFields: {
    type: "spec",
    spec_kind: "test-plan",
  },
});
