export { claimSlice } from "./claim";
export { startSlice } from "./start";
export { verifySlice } from "./verify";
export { closeSlice } from "./close";
export { createIssueSlice } from "./slice-scaffold";
export { repairHistoricalDoneSlices } from "./slice-repair";
export {
  detectDomainModelRefs,
  detectPrdRefs,
  detectResearchRefs,
  detectSlicesPhase,
  detectTddEvidence,
  detectVerifyPhase,
  tailLogFromPath,
  type DetectionFinding,
} from "./forge-evidence-readers";
