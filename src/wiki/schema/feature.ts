import { buildSpecSchema } from "./shared";

export const featureSchema = buildSpecSchema({
  kind: "feature",
  contractId: "feature",
  title: "wiki feature frontmatter",
  constFields: {
    type: "spec",
    spec_kind: "feature",
  },
});
