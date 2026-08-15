import { FastifyInstance } from "fastify";
import { productsService, plansService } from "../services";

export async function publicCatalogRoutes(fastify: FastifyInstance) {
  // Public: active public products with their public active plans
  fastify.get("/products", async (req, reply) => {
    const products = await productsService.listProducts({ status: "active" });
    const publicProducts = products.filter((p) => p.visibility === "public");
    const plans = await plansService.listActivePublicPlans();

    const result = [];
    for (const product of publicProducts) {
      const productPlans = plans.filter((p) => p.productId === product.id);
      result.push({
        id: product.id,
        key: product.key,
        name: product.name,
        description: product.description,
        plans: productPlans.map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          description: p.description,
          billingType: p.billingType,
          billingInterval: p.billingInterval,
          intervalCount: p.intervalCount,
          currency: p.currency,
          amountMinor: p.amountMinor,
          trialDays: p.trialDays,
        })),
      });
    }
    return reply.status(200).send({ products: result });
  });

  // Public: single product by stable key
  fastify.get("/products/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const product = await productsService.getProductByKey(key);
    if (
      !product ||
      product.status !== "active" ||
      product.visibility !== "public"
    ) {
      return reply
        .status(404)
        .send({
          errors: [
            {
              code: "PRODUCT_NOT_FOUND",
              message: "Product not found",
              requestId: req.id,
            },
          ],
        });
    }
    const plans = (await plansService.listActivePublicPlans()).filter(
      (p) => p.productId === product.id,
    );
    return reply.status(200).send({
      product: {
        id: product.id,
        key: product.key,
        name: product.name,
        description: product.description,
        plans: plans.map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          description: p.description,
          billingType: p.billingType,
          billingInterval: p.billingInterval,
          intervalCount: p.intervalCount,
          currency: p.currency,
          amountMinor: p.amountMinor,
          trialDays: p.trialDays,
        })),
      },
    });
  });
}
