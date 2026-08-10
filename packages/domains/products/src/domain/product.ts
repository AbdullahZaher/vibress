export type ProductStatus = 'active' | 'archived';
export type ProductVisibility = 'public' | 'private';

export interface Product {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProductStatus;
  visibility: ProductVisibility;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateProductData {
  id?: string | undefined;
  key: string;
  name: string;
  description?: string | null | undefined;
  status?: ProductStatus | undefined;
  visibility?: ProductVisibility | undefined;
}

export interface UpdateProductData {
  name?: string | undefined;
  description?: string | null | undefined;
  visibility?: ProductVisibility | undefined;
}
