import { ProductRepository } from "../domain/repository";
import {
  Product,
  CreateProductData,
  UpdateProductData,
} from "../domain/product";
import { domainEvents } from "@vibress/events";

export class ProductDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const PRODUCT_KEY_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export class ProductsService {
  constructor(private repo: ProductRepository) {}

  async createProduct(
    data: CreateProductData,
    actorId: string | null,
    publicationId?: string,
  ): Promise<Product> {
    const pubId = publicationId || data.publicationId || "pub_default";
    const key = data.key.trim().toLowerCase();
    if (!PRODUCT_KEY_REGEX.test(key)) {
      throw new ProductDomainError(
        "VALIDATION_ERROR",
        "Product key must be lowercase alphanumeric with hyphens",
      );
    }
    if (data.name.trim().length > 100) {
      throw new ProductDomainError(
        "VALIDATION_ERROR",
        "Product name is too long",
      );
    }
    const existing = await this.repo.findByKey(key, pubId);
    if (existing) {
      throw new ProductDomainError(
        "VALIDATION_ERROR",
        "Product key already exists",
      );
    }

    const product = await this.repo.create({ ...data, key, publicationId: pubId });
    domainEvents.emit("product.created", { productId: product.id, actorId, publicationId: pubId });
    return product;
  }

  async updateProduct(
    id: string,
    data: UpdateProductData,
    actorId: string | null,
    publicationId?: string,
  ): Promise<Product> {
    const existing = await this.repo.findById(id, publicationId);
    if (!existing)
      throw new ProductDomainError("PRODUCT_NOT_FOUND", "Product not found");
    const updated = await this.repo.update(id, data, publicationId);
    domainEvents.emit("product.updated", { productId: id, actorId, publicationId: existing.publicationId });
    return updated;
  }

  async archiveProduct(id: string, actorId: string | null, publicationId?: string): Promise<Product> {
    const existing = await this.repo.findById(id, publicationId);
    if (!existing)
      throw new ProductDomainError("PRODUCT_NOT_FOUND", "Product not found");
    const archived = await this.repo.archive(id, publicationId);
    domainEvents.emit("product.archived", { productId: id, actorId, publicationId: existing.publicationId });
    return archived;
  }

  async getProduct(id: string, publicationId?: string): Promise<Product | null> {
    return this.repo.findById(id, publicationId);
  }

  async getProductByKey(key: string, publicationId?: string): Promise<Product | null> {
    return this.repo.findByKey(key, publicationId);
  }

  async listProducts(filter?: {
    status?: "active" | "archived";
    includeArchived?: boolean;
    publicationId?: string;
  }): Promise<Product[]> {
    return this.repo.list(filter);
  }
}
