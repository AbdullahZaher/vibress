import {
  Product,
  CreateProductData,
  UpdateProductData,
  ProductStatus,
} from "./product";

export interface ProductRepository {
  create(data: CreateProductData): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  findByKey(key: string): Promise<Product | null>;
  update(id: string, data: UpdateProductData): Promise<Product>;
  archive(id: string): Promise<Product>;
  list(filter?: {
    status?: ProductStatus;
    includeArchived?: boolean;
  }): Promise<Product[]>;
}
