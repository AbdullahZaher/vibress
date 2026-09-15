import {
  Product,
  CreateProductData,
  UpdateProductData,
  ProductStatus,
} from "./product";

export interface ProductRepository {
  create(data: CreateProductData & { publicationId?: string }): Promise<Product>;
  findById(id: string, publicationId?: string): Promise<Product | null>;
  findByKey(key: string, publicationId?: string): Promise<Product | null>;
  update(id: string, data: UpdateProductData, publicationId?: string): Promise<Product>;
  archive(id: string, publicationId?: string): Promise<Product>;
  list(filter?: {
    status?: ProductStatus;
    includeArchived?: boolean;
    publicationId?: string;
  }): Promise<Product[]>;
}
