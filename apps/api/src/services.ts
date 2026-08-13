import { DrizzleUserRepository, UsersService } from '@vibress/users';
import { DrizzleRoleRepository, RolesService } from '@vibress/roles';
import { DrizzlePermissionRepository, PermissionsService } from '@vibress/permissions';
import { DrizzleAuditRepository, AuditService } from '@vibress/audit';
import { DrizzleSessionRepository, AuthService } from '@vibress/auth';
import { DrizzleTagRepository, TagsService } from '@vibress/tags';
import { DrizzleAuthorRepository, AuthorsService } from '@vibress/authors';
import { DrizzleRevisionRepository, RevisionsService } from '@vibress/revisions';
import { DrizzlePostRepository, PostsService } from '@vibress/posts';
import { DrizzlePageRepository, PagesService } from '@vibress/pages';
import { LocalStorageProvider, defaultStorageRegistry } from '@vibress/storage-core';
import { DrizzleMediaRepository, MediaService } from '@vibress/media';
import { getConfig } from '@vibress/config';
import { SetupService, DrizzleInstallationRepository } from '@vibress/setup';

import { DrizzleStorageRepository, StorageService } from '@vibress/storage-domain';
import {
  DrizzleThemeConfigurationRepository,
  ThemeService,
} from '@vibress/themes';
import { listThemeMetadata } from '@vibress/themes-registry';
import { validateThemeManifest, validateThemeCompatibility, validateThemeSettings, mergeThemeSettings } from '@vibress/theme-core';
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MembersService,
  MemberAuthService,
} from '@vibress/members';
import { SmtpMemberAuthMailer } from './mailer/member-auth-mailer';
import {
  DrizzleProductRepository,
  ProductsService,
} from '@vibress/products';
import {
  DrizzlePlanRepository,
  PlansService,
} from '@vibress/plans';
import {
  DrizzleOfferRepository,
  OffersService,
} from '@vibress/offers';
import {
  DrizzleSubscriptionRepository,
  SubscriptionsService,
} from '@vibress/subscriptions';
import {
  DrizzleBillingCustomerRepository,
  DrizzleBillingPlanMappingRepository,
  DrizzleBillingWebhookEventRepository,
  DrizzleBillingEventRepository,
  BillingService,
  StripeBillingProvider,
} from '@vibress/billing';
import {
  DrizzleNewsletterRepository,
  DrizzleNewsletterPreferenceRepository,
  DrizzleSendRepository,
  NewslettersService,
  BillingAwareMemberAudienceRepository,
} from '@vibress/newsletters';
import {
  DrizzleEmailRecipientRepository,
  DrizzleEmailEventRepository,
  DrizzleEmailSuppressionRepository,
  DrizzleProviderEventRepository,
  EmailService,
  SmtpEmailProvider,
} from '@vibress/email';

import { NewsletterSendEnqueuer } from './newsletter-send-enqueuer';

import {
  DrizzleCommentRepository,
  DrizzleCommentLikeRepository,
  DrizzleCommentReportRepository,
  CommentsService,
} from '@vibress/comments';
import {
  DrizzleNotificationRepository,
  NotificationsService,
} from '@vibress/notifications';
import {
  DrizzleRecommendationRepository,
  DrizzleRecommendationEventRepository,
  RecommendationsService,
} from '@vibress/recommendations';
import {
  DrizzleIntegrationRepository,
  DrizzleApiKeyRepository,
  IntegrationsService,
} from '@vibress/integrations';
import {
  DrizzleWebhookRepository,
  WebhooksService,
} from '@vibress/webhooks';
import {
  DrizzlePluginRepository,
  DrizzlePluginSettingRepository,
  PluginsService,
} from '@vibress/plugins';
import { BundledPluginHost } from './plugins/plugin-host';
import { NativeImportProcessor, NativeExportCollector } from './import-export-processors';
import {
  DrizzleAnalyticsRepository,
  AnalyticsService,
} from '@vibress/analytics';
import { AnalyticsOverviewService } from '@vibress/analytics';
import {
  DrizzleSearchRepository,
  SearchService,
} from '@vibress/search';
import {
  DrizzleAutomationRepository,
  AutomationsService,
  AutomationAction,
} from '@vibress/automations';
import {
  DrizzleSettingRepository,
  SettingsService,
} from '@vibress/settings';
import {
  DrizzleRedirectRepository,
  RedirectsService,
} from '@vibress/redirects';
import {
  DrizzleImportExportJobRepository,
  ImportExportService,
} from '@vibress/import-export';

const config = getConfig();

const themeDefinitionRegistry = {
  has: (id: string) => listThemeMetadata().some((t) => t.manifest.id === id),
  get: (id: string) => {
    const found = listThemeMetadata().find((t) => t.manifest.id === id);
    return found ? { manifest: found.manifest, settingsSchema: found.settingsSchema } : null;
  },
  list: () => listThemeMetadata().map((t) => ({ manifest: t.manifest, settingsSchema: t.settingsSchema })),
  validate: (manifest: unknown) => validateThemeManifest(manifest),
  checkCompatibility: (manifest: ReturnType<typeof validateThemeManifest>) => validateThemeCompatibility(manifest),
};

const userRepo = new DrizzleUserRepository();
const roleRepo = new DrizzleRoleRepository();
const permRepo = new DrizzlePermissionRepository();
const auditRepo = new DrizzleAuditRepository();
const sessionRepo = new DrizzleSessionRepository();
const tagRepo = new DrizzleTagRepository();
const authorRepo = new DrizzleAuthorRepository();
const revisionRepo = new DrizzleRevisionRepository();
const postRepo = new DrizzlePostRepository();
const pageRepo = new DrizzlePageRepository();
const storageRepo = new DrizzleStorageRepository();

const localStorageProvider = new LocalStorageProvider();
defaultStorageRegistry.register(localStorageProvider);
defaultStorageRegistry.setActiveProvider('local');

const mediaRepo = new DrizzleMediaRepository();
const themeConfigRepo = new DrizzleThemeConfigurationRepository();
const memberRepo = new DrizzleMemberRepository();
const memberAuthTokenRepo = new DrizzleMemberAuthTokenRepository();
const memberSessionRepo = new DrizzleMemberSessionRepository();
const productRepo = new DrizzleProductRepository();
const planRepo = new DrizzlePlanRepository();
const offerRepo = new DrizzleOfferRepository();
const subscriptionRepo = new DrizzleSubscriptionRepository();
const billingCustomerRepo = new DrizzleBillingCustomerRepository();
const billingPlanMappingRepo = new DrizzleBillingPlanMappingRepository();
const billingWebhookEventRepo = new DrizzleBillingWebhookEventRepository();
export const billingEventRepo = new DrizzleBillingEventRepository();

export const themeService = new ThemeService(themeConfigRepo, themeDefinitionRegistry);
export const membersService = new MembersService(memberRepo, memberSessionRepo);
export const memberAuthService = new MemberAuthService(
  memberRepo,
  memberAuthTokenRepo,
  memberSessionRepo,
  new SmtpMemberAuthMailer(),
  () => getConfig().members.signupEnabled
);

export const productsService = new ProductsService(productRepo);
export const plansService = new PlansService(planRepo, async (id) => !!(await productRepo.findById(id)));
export const offersService = new OffersService(
  offerRepo,
  async (id) => !!(await productRepo.findById(id)),
  async (id) => !!(await planRepo.findById(id))
);
export const subscriptionsService = new SubscriptionsService(subscriptionRepo);

// ---------------- Newsletters & Email ----------------
const newsletterRepo = new DrizzleNewsletterRepository();
const newsletterPrefRepo = new DrizzleNewsletterPreferenceRepository();
const newsletterSendRepo = new DrizzleSendRepository();
const emailRecipientRepo = new DrizzleEmailRecipientRepository();
const emailEventRepo = new DrizzleEmailEventRepository();
const emailSuppressionRepo = new DrizzleEmailSuppressionRepository();
const emailProviderEventRepo = new DrizzleProviderEventRepository();

export const emailProvider = new SmtpEmailProvider({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  user: config.smtp.user,
  pass: config.smtp.pass,
  webhookSecret: config.email.webhookSecret,
});

export let emailService = new EmailService({
  provider: emailProvider,
  recipientRepo: emailRecipientRepo,
  eventRepo: emailEventRepo,
  suppressionRepo: emailSuppressionRepo,
  providerEventRepo: emailProviderEventRepo,
});

/**
 * Test seam: allows integration tests to inject a provider with a known
 * webhook secret before building the app. Live binding — route modules see
 * the replacement at request time.
 */
export function setEmailServiceForTests(service: EmailService): void {
  emailService = service;
}

export const newslettersService = new NewslettersService({
  newsletterRepo,
  preferenceRepo: newsletterPrefRepo,
  sendRepo: newsletterSendRepo,
  audienceRepo: new BillingAwareMemberAudienceRepository(memberRepo, subscriptionRepo),
  isMemberSuppressed: (email) => emailSuppressionRepo.isSuppressed(email),
  unsubscribeSecret: config.newsletters.unsubscribeSecret || 'dev-unsub-secret',
  portalUrl: config.site.portalUrl,
});

export const newsletterSendEnqueuer = new NewsletterSendEnqueuer(newslettersService);

// ---------------- Community: Comments, Notifications, Recommendations ----------------
const notificationRepo = new DrizzleNotificationRepository();
export const notificationsService = new NotificationsService(notificationRepo);
export const commentsService = new CommentsService({
  commentRepo: new DrizzleCommentRepository(),
  likeRepo: new DrizzleCommentLikeRepository(),
  reportRepo: new DrizzleCommentReportRepository(),
  notificationSink: notificationsService,
});
export const recommendationsService = new RecommendationsService(
  new DrizzleRecommendationRepository(),
  new DrizzleRecommendationEventRepository()
);

// ---------------- Platform: Integrations, API Keys, Webhooks, Plugins ----------------
export const integrationsService = new IntegrationsService(
  new DrizzleIntegrationRepository(),
  new DrizzleApiKeyRepository()
);

// Webhook dispatcher: enqueues into the shared BullMQ queue via a lightweight
// API-side queue handle. The worker owns actual delivery.
import { Queue, QUEUE_NAMES, enqueueTraced, getBullMqRedisConnection } from '@vibress/queue';
const webhookQueueName = QUEUE_NAMES.WEBHOOK_DELIVERY;
const webhookQueue = new Queue(webhookQueueName, {
  connection: getBullMqRedisConnection(),
  defaultJobOptions: { attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
});
export const webhooksService = new WebhooksService(new DrizzleWebhookRepository(), {
  enqueue: async (deliveryId: string, endpointId: string) => {
    await enqueueTraced(webhookQueue, 'deliver', { deliveryId, endpointId }, {
      jobId: `delivery-${deliveryId}`,
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  },
});

export const pluginsService = new PluginsService(
  new DrizzlePluginRepository(),
  new DrizzlePluginSettingRepository(),
  new BundledPluginHost()
);

// ---------------- Intelligence: Analytics, Search, Automations ----------------
export const analyticsService = new AnalyticsService(new DrizzleAnalyticsRepository());
export const analyticsOverviewService = new AnalyticsOverviewService(new DrizzleAnalyticsRepository());
export const searchService = new SearchService(new DrizzleSearchRepository());

const automationRunQueueName = QUEUE_NAMES.AUTOMATIONS_RUN;
const automationRunQueue = new Queue(automationRunQueueName, {
  connection: getBullMqRedisConnection(),
  defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 2000 },
});
const automationDelayedQueueName = QUEUE_NAMES.AUTOMATIONS_DELAYED;
const automationDelayedQueue = new Queue(automationDelayedQueueName, {
  connection: getBullMqRedisConnection(),
  defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 2000 },
});

export const automationsService = new AutomationsService(
  new DrizzleAutomationRepository(),
  {
    enqueueRun: async (runId: string) => {
      await enqueueTraced(automationRunQueue, 'run', { runId }, { jobId: `run-${runId}` });
    },
    enqueueDelayedStep: async (runId: string, stepIndex: number, delayMs: number) => {
      await enqueueTraced(automationDelayedQueue, 'resume', { runId, stepIndex, resumeAt: Date.now() + delayMs }, {
        delay: delayMs,
        jobId: `resume-${runId}-${stepIndex}`,
      });
    },
  },
  {
    execute: async (action: AutomationAction) => {
      // Default no-op executor for API-side validation; the worker runs real actions.
      return { result: { dryRun: true } };
    },
  }
);

export const billingProvider = new StripeBillingProvider({
  secretKey: config.billing.stripeSecretKey || 'sk_test_missing',
  webhookSecret: config.billing.stripeWebhookSecret || '',
});

export let billingService = new BillingService({
  provider: billingProvider,
  customerRepo: billingCustomerRepo,
  mappingRepo: billingPlanMappingRepo,
  webhookEventRepo: billingWebhookEventRepo,
  billingEventRepo,
  subscriptionsService,
  offersService,
  planRepository: planRepo,
  productRepository: productRepo,
  memberRepository: memberRepo,
  memberEmailProvider: (member) => member.email,
  portalUrl: config.billing.portalUrl,
  successPath: '/account',
  cancelPath: '/plans',
});

/**
 * Test seam: allows integration tests to inject a fake provider-backed
 * billing service before building the app. Live binding — route modules
 * see the replacement at request time.
 */
export function setBillingServiceForTests(service: BillingService): void {
  billingService = service;
}

export const storageService = new StorageService(storageRepo, auditRepo, defaultStorageRegistry);
export const usersService = new UsersService(userRepo);
export const rolesService = new RolesService(roleRepo);
export const permissionsService = new PermissionsService(permRepo);
export const auditService = new AuditService(auditRepo);
export const authService = new AuthService(sessionRepo, userRepo, roleRepo, permRepo, auditRepo);
export const tagsService = new TagsService(tagRepo);
export const authorsService = new AuthorsService(authorRepo);
export const revisionsService = new RevisionsService(revisionRepo);
export const mediaService = new MediaService(mediaRepo, defaultStorageRegistry, auditRepo);
export const postsService = new PostsService(postRepo, revisionsService, authorRepo, auditRepo, mediaService);
export const pagesService = new PagesService(pageRepo, revisionsService, authorRepo, auditRepo, mediaService);

// ---------------- Operations: Settings, Redirects, Import/Export ----------------
export const settingsService = new SettingsService(new DrizzleSettingRepository(), auditService);
export const setupService = new SetupService(new DrizzleInstallationRepository());
export const redirectsService = new RedirectsService(new DrizzleRedirectRepository());
export const importExportService = new ImportExportService(
  new DrizzleImportExportJobRepository(),
  new NativeImportProcessor({ settingsService, redirectsService }),
  new NativeExportCollector({ settingsService, redirectsService })
);
