import type { VibressThemeDefinition } from "../types";
import {
  defaultThemeManifest,
  defaultThemeSettingsSchema,
} from "@vibress/themes-registry";

export const defaultTheme: VibressThemeDefinition = {
  manifest: defaultThemeManifest,
  settingsSchema: defaultThemeSettingsSchema,
  components: {
    Home: (props) => import("./components/Home").then((m) => m.Home(props)),
    Post: (props) => import("./components/Post").then((m) => m.Post(props)),
    Page: (props) => import("./components/Page").then((m) => m.Page(props)),
    TagArchive: (props) =>
      import("./components/TagArchive").then((m) => m.TagArchive(props)),
    AuthorArchive: (props) =>
      import("./components/AuthorArchive").then((m) => m.AuthorArchive(props)),
  },
  cssPath: "/theme-assets/vibress-default/1.0.0/casper.css",
};
