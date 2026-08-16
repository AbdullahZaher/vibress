import type { VibressThemeDefinition } from "../types";
import {
  minimalThemeManifest,
  minimalThemeSettingsSchema,
} from "@vibress/themes-registry";
import { Home } from "./components/Home";
import { Post } from "./components/Post";
import { Page } from "./components/Page";
import { TagArchive } from "./components/TagArchive";
import { AuthorArchive } from "./components/AuthorArchive";

export const minimalTheme: VibressThemeDefinition = {
  manifest: minimalThemeManifest,
  settingsSchema: minimalThemeSettingsSchema,
  components: {
    Home,
    Post,
    Page,
    TagArchive,
    AuthorArchive,
  },
  cssPath: "/theme-assets/vibress-minimal/1.0.0/source.css",
};

