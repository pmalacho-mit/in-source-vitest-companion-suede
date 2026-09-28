import type { TestArtifactBase } from "vitest";
import type { Encoded } from "./codec.ts";

export const DISPLAY = "in-source-companion:display";

export type DisplayArtifact = TestArtifactBase & {
  type: typeof DISPLAY;
  page: string;
  actual: Encoded;
  expected: Encoded;
  meta: Encoded;
};

declare module "vitest" {
  interface TestArtifactRegistry {
    "in-source-companion:display": DisplayArtifact;
  }
}
