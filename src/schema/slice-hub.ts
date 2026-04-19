import { buildSpecSchema } from "./shared";

export const sliceHubSchema = buildSpecSchema({
  kind: "slice-hub",
  contractId: "slice-index",
  title: "wiki slice hub frontmatter",
  constFields: {
    type: "spec",
    spec_kind: "task-hub",
  },
});
