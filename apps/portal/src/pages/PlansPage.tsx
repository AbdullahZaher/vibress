import { useEffect, useState } from "react";
import {
  fetchProducts,
  formatPrice,
  PublicPlan,
  PublicProduct,
} from "../lib/catalog";
import { memberApi } from "../lib/member-api";
import { navigate } from "../router";
import { useTranslation } from "../lib/i18n";
import { PortalHeader } from "../components/PortalHeader";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Badge,
  Alert,
  Skeleton,
  EmptyState,
} from "@vibress/ui";
import { CreditCard, Check, Sparkles, ArrowLeft } from "lucide-react";

export function PlansPage() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const startCheckout = async (plan: PublicPlan) => {
    setStarting(plan.id);
    setError(null);
    try {
      const { checkoutUrl } = await memberApi.createCheckout(plan.id);
      window.location.href = checkoutUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setStarting(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      <PortalHeader showBack={true} backPath="/account" />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* Page Header */}
        <div className="mb-8 text-start">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="text-xs font-semibold gap-1.5 py-0.5">
              <Sparkles className="size-3 text-primary" />
              {t("portal.plans_title")}
            </Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("portal.plans_title")}
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-muted-foreground max-w-2xl">
            {t("portal.plans_desc")}
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive" className="mb-6">
            <span>{error}</span>
          </Alert>
        )}

        {/* Loading Skeletons */}
        {loading && (
          <div className="space-y-8">
            <div className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Skeleton className="h-72 w-full rounded-xl" />
                <Skeleton className="h-72 w-full rounded-xl" />
                <Skeleton className="h-72 w-full rounded-xl" />
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && products.length === 0 && (
          <Card className="p-8">
            <EmptyState
              icon={<CreditCard className="size-10" />}
              title="No plans available yet"
              description="Membership tiers are being prepared. Check back soon."
              action={
                <Button
                  variant="outline"
                  onClick={() => navigate("/account")}
                  className="mt-4"
                >
                  <ArrowLeft className="size-4 rtl:rotate-180 me-1.5" />
                  {t("portal.account_title")}
                </Button>
              }
            />
          </Card>
        )}

        {/* Products and Plans List */}
        {!loading &&
          products.map((product) => (
            <section key={product.id} className="mb-10 text-start">
              <div className="mb-4">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  {product.name}
                </h2>
                {product.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {product.description}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {product.plans.map((plan) => {
                  const isProcessing = starting === plan.id;
                  return (
                    <Card
                      key={plan.id}
                      className="flex flex-col justify-between transition-all duration-200 hover:border-primary/40 hover:shadow-md"
                    >
                      <CardHeader className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-base sm:text-lg font-semibold text-foreground">
                            {plan.name}
                          </CardTitle>
                          {plan.trialDays > 0 && (
                            <Badge variant="success" className="text-xs shrink-0">
                              {plan.trialDays}-day trial
                            </Badge>
                          )}
                        </div>
                        {plan.description && (
                          <CardDescription className="text-xs sm:text-sm line-clamp-2">
                            {plan.description}
                          </CardDescription>
                        )}
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div className="pt-2 border-t border-border/60">
                          <div className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                            {formatPrice(plan)}
                          </div>
                        </div>

                        {/* Feature bullets if trial */}
                        {plan.trialDays > 0 && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Check className="size-3.5 text-success shrink-0" />
                            <span>Free trial included</span>
                          </div>
                        )}
                      </CardContent>

                      <CardFooter className="pt-2">
                        <Button
                          onClick={() => startCheckout(plan)}
                          disabled={isProcessing}
                          loading={isProcessing}
                          className="w-full h-11 sm:h-12 text-sm sm:text-base font-bold rounded-xl shadow-xs"
                          variant="primary"
                        >
                          {isProcessing
                            ? t("portal.saving")
                            : t("portal.select_plan")}
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}

        {/* Back to Account CTA */}
        <div className="pt-6 border-t border-border/60 flex items-center justify-start">
          <Button
            variant="outline"
            size="default"
            onClick={() => navigate("/account")}
            className="text-muted-foreground hover:text-foreground h-10 px-4 text-sm font-medium rounded-xl border-border/80 shadow-2xs gap-2"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            <span>{t("portal.account_title")}</span>
          </Button>
        </div>
      </main>
    </div>
  );
}
