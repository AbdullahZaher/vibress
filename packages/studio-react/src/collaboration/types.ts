import { Doc } from "yjs";
import { Provider } from "@lexical/yjs";

export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  avatar?: string | undefined;
}

export type CollaborationProvider = Provider;

export interface CollaborationConfig {
  id: string; // Document / Post ID
  user: CollaborationUser;
  providerFactory: (
    id: string,
    yjsDocMap: Map<string, Doc>,
  ) => Provider;
  cursorColor?: string | undefined;
}
