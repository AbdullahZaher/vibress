import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getDb, publications, products, plans } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { DrizzleProductRepository } from "../infrastructure/drizzle-product-repository";
import { ProductsService, ProductDomainError } from "../application/products-service";

describe("Products Multi-Publication Isolation", () => {
  let productRepo: DrizzleProductRepository;
  let productsService: ProductsService;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(publications)
      .values([
        {
          id: "pub_alpha",
          workspaceId: "ws_default",
          name: "Alpha Pub",
          slug: "alpha",
          primaryLocale: "en",
        },
        {
          id: "pub_beta",
          workspaceId: "ws_default",
          name: "Beta Pub",
          slug: "beta",
          primaryLocale: "en",
        },
      ])
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.delete(plans).where(inArray(plans.publicationId, ["pub_alpha", "pub_beta"]));
    await db.delete(products).where(inArray(products.publicationId, ["pub_alpha", "pub_beta"]));

    productRepo = new DrizzleProductRepository();
    productsService = new ProductsService(productRepo);
  });

  it("permits identical product keys across distinct publications (Same-key requirement)", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";
    const commonKey = "supporter-tier";

    const prodA = await productsService.createProduct(
      {
        key: commonKey,
        name: "Supporter Tier Alpha",
      },
      "staff_1",
      pubA,
    );

    const prodB = await productsService.createProduct(
      {
        key: commonKey,
        name: "Supporter Tier Beta",
      },
      "staff_2",
      pubB,
    );

    expect(prodA.publicationId).toBe(pubA);
    expect(prodB.publicationId).toBe(pubB);
    expect(prodA.key).toBe(commonKey);
    expect(prodB.key).toBe(commonKey);
    expect(prodA.id).not.toBe(prodB.id);

    const foundA = await productsService.getProductByKey(commonKey, pubA);
    const foundB = await productsService.getProductByKey(commonKey, pubB);

    expect(foundA?.id).toBe(prodA.id);
    expect(foundB?.id).toBe(prodB.id);
  });

  it("denies cross-publication product reads and mutations", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const prodA = await productsService.createProduct(
      {
        key: "secret-tier",
        name: "Secret Tier",
      },
      "staff_1",
      pubA,
    );

    // Read from B
    const readFromB = await productsService.getProduct(prodA.id, pubB);
    expect(readFromB).toBeNull();

    // Update from B
    await expect(
      productsService.updateProduct(prodA.id, { name: "Hacked" }, "attacker", pubB),
    ).rejects.toThrow(ProductDomainError);

    // Archive from B
    await expect(
      productsService.archiveProduct(prodA.id, "attacker", pubB),
    ).rejects.toThrow(ProductDomainError);

    const intactA = await productsService.getProduct(prodA.id, pubA);
    expect(intactA?.name).toBe("Secret Tier");
    expect(intactA?.status).toBe("active");
  });

  it("filters product listings strictly by publication", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    await productsService.createProduct({ key: "list-a", name: "List A" }, "staff", pubA);
    await productsService.createProduct({ key: "list-b", name: "List B" }, "staff", pubB);

    const listA = await productsService.listProducts({ publicationId: pubA });
    const listB = await productsService.listProducts({ publicationId: pubB });

    expect(listA.every((p) => p.publicationId === pubA)).toBe(true);
    expect(listB.every((p) => p.publicationId === pubB)).toBe(true);
  });
});
