import { StudioCardDefinition } from '@vibress/studio-cards';

export interface StudioPlugin {
  name: string;
  version: string;
  cards?: StudioCardDefinition<any>[];
  toolbarItems?: StudioToolbarItem[];
}

export interface StudioToolbarItem {
  id: string;
  label: string;
  icon?: string;
  execute(editor: unknown): void;
}

export class StudioPluginRegistry {
  private plugins: Map<string, StudioPlugin> = new Map();
  private cards: Map<string, StudioCardDefinition<any>> = new Map();

  registerPlugin(plugin: StudioPlugin): void {
    if (this.plugins.has(plugin.name)) {
      return;
    }
    this.plugins.set(plugin.name, plugin);

    if (plugin.cards) {
      for (const card of plugin.cards) {
        this.cards.set(card.type, card);
      }
    }
  }

  getCard(type: string): StudioCardDefinition<any> | undefined {
    return this.cards.get(type);
  }

  getPlugins(): StudioPlugin[] {
    return Array.from(this.plugins.values());
  }
}
