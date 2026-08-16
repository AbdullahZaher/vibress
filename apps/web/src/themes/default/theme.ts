import type { VibressThemeDefinition } from "../types";
import {
  defaultThemeManifest,
  defaultThemeSettingsSchema,
} from "@vibress/themes-registry";
import { Home } from "./components/Home";
import { Post } from "./components/Post";
import { Page } from "./components/Page";
import { TagArchive } from "./components/TagArchive";
import { AuthorArchive } from "./components/AuthorArchive";

export const defaultTheme: VibressThemeDefinition = {
  manifest: defaultThemeManifest,
  settingsSchema: defaultThemeSettingsSchema,
  components: {
    Home,
    Post,
    Page,
    TagArchive,
    AuthorArchive,
  },
  cssPath: "/theme-assets/vibress-default/1.0.0/casper.css",
};

