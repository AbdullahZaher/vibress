import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// These regressions use in-memory editors and mocked HTTP. They do not need
// the global integration setup that migrates and seeds a developer database.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    globalSetup: [],
    include: [
      "packages/studio-core/src/__tests__/*.test.ts",
      "packages/studio-serializer/src/__tests__/*.test.ts",
      "packages/studio-react/src/__tests__/{document-recovery,legacy-root-load,host-document-sync}.test.tsx",
      "apps/admin/src/components/__tests__/{editor-document-recovery,post-editor-autosave,page-editor-autosave}.test.tsx",
    ],
  },
});
