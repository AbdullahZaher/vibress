import { StorageProvider } from "./storage-provider";
import { StorageError } from "./errors";

export class StorageRegistry {
  private providers = new Map<string, StorageProvider>();
  private activeProviderName: string = "local";

  register(provider: StorageProvider): void {
    this.providers.set(provider.name, provider);
  }

  unregister(name: string): void {
    this.providers.delete(name);
  }

  setActiveProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new StorageError(`Storage provider '${name}' is not registered`);
    }
    this.activeProviderName = name;
  }

  getActiveProvider(): StorageProvider {
    const provider = this.providers.get(this.activeProviderName);
    if (!provider) {
      throw new StorageError(
        `Active storage provider '${this.activeProviderName}' is not registered`,
      );
    }
    return provider;
  }

  getProvider(name: string): StorageProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new StorageError(`Storage provider '${name}' is not registered`);
    }
    return provider;
  }

  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }
}

export const defaultStorageRegistry = new StorageRegistry();
