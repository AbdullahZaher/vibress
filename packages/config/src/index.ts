import { z } from 'zod';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type EventDeliveryMode = 'outbox' | 'direct';

export class ConfigError extends Error {
  constructor(message: string, public issues: string[] = []) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type EnvSource = Record<string, string | undefined>;

declare const process: { env: EnvSource };

export interface AppConfig {
  env: NodeEnvironment;
  isProduction: boolean;
  isTest: boolean;
  logLevel: string;
  ports: { api: number; web: number; admin: number; portal: number; workerHealth: number };
  database: { url: string };
  redis: { url: string };
  site: {
    url: string;
    portalUrl: string;
    apiUrl: string | null;
    name: string;
    description: string;
    locale: string;
  };
  cors: {
    origin: true | string[];
    origins: string[];
    staffAllowedOrigins: string[];
    memberAllowedOrigins: string[];
  };
  cookies: { staffSessionName: string; memberSessionName: string; secure: boolean };
  smtp: { host: string; port: number; secure: boolean; user: string | null; pass: string | null; from: string };
  email: { webhookSecret: string | null };
  newsletters: { unsubscribeSecret: string | null };
  members: { signupEnabled: boolean };
  billing: { stripeSecretKey: string | null; stripeWebhookSecret: string | null; portalUrl: string };
  secrets: { encryptionKey: string | null };
  outbox: { deliveryMode: EventDeliveryMode; publishedRetentionDays: number; failedRetentionDays: number };
  system: { version: string; storageProvider: string };
  observability: {
    metricsEnabled: boolean;
    tracingEnabled: boolean;
    tracing: {
      otlpEndpoint: string;
      otlpHeaders: Record<string, string>;
      serviceName: string;
      samplingRatio: number;
      resourceAttributes: Record<string, string>;
    };
  };
}

const emptyToUndefined = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
};

const nonEmptyString = z.preprocess(emptyToUndefined, z.string().min(1));
const optionalNonEmptyString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const urlString = z.preprocess(emptyToUndefined, z.string().url());
const optionalUrlString = z.preprocess(emptyToUndefined, z.string().url().optional());
const csvString = z.preprocess(
  emptyToUndefined,
  z.string().refine((value) => value.split(',').every((origin) => isUrl(origin.trim())), 'must be a comma-separated URL list')
);
const optionalCsvString = z.preprocess(emptyToUndefined, csvString.optional());
const intString = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().int().positive());
const boolString = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: nonEmptyString.default('info'),
  VIBRESS_VERSION: nonEmptyString.default('0.0.0'),

  API_PORT: intString.default(7780),
  WEB_PORT: intString.default(7778),
  ADMIN_PORT: intString.default(7779),
  PORTAL_PORT: intString.default(7781),
  WORKER_HEALTH_PORT: intString.default(7782),

  DATABASE_URL: nonEmptyString.default('postgresql://vibress:vibress@127.0.0.1:5433/vibress'),
  REDIS_URL: nonEmptyString.default('redis://127.0.0.1:6380'),

  SITE_URL: urlString.default('http://localhost:7777'),
  PORTAL_URL: optionalUrlString,
  API_URL: optionalUrlString,
  SITE_NAME: nonEmptyString.default('Vibress'),
  SITE_DESCRIPTION: nonEmptyString.default('Publishing Platform'),
  SITE_LOCALE: nonEmptyString.default('en'),
  ADMIN_ORIGIN: optionalUrlString,
  PORTAL_ORIGIN: optionalUrlString,
  CORS_ORIGINS: optionalCsvString,

  SESSION_COOKIE_NAME: nonEmptyString.default('vibress_session'),
  MEMBER_SESSION_COOKIE_NAME: nonEmptyString.default('vibress_member_session'),

  SMTP_HOST: nonEmptyString.default('127.0.0.1'),
  SMTP_PORT: intString.default(1025),
  SMTP_SECURE: boolString.default(false),
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASS: optionalNonEmptyString,
  SMTP_PASSWORD: optionalNonEmptyString,
  SMTP_FROM: nonEmptyString.default('Vibress <no-reply@vibress.local>'),
  EMAIL_WEBHOOK_SECRET: optionalNonEmptyString,

  MEMBERS_SIGNUP_ENABLED: boolString.default(true),
  NEWSLETTER_UNSUBSCRIBE_SECRET: optionalNonEmptyString,

  STRIPE_SECRET_KEY: optionalNonEmptyString,
  STRIPE_WEBHOOK_SECRET: optionalNonEmptyString,

  VIBRESS_ENCRYPTION_KEY: optionalNonEmptyString,
  STORAGE_PROVIDER: nonEmptyString.default('local'),

  EVENT_DELIVERY_MODE: z.enum(['outbox', 'direct']).default('outbox'),
  OUTBOX_PUBLISHED_RETENTION_DAYS: intString.default(7),
  OUTBOX_FAILED_RETENTION_DAYS: intString.default(30),

  METRICS_ENABLED: boolString.default(true),
  TRACING_ENABLED: boolString.default(true),

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrlString,
  OTEL_EXPORTER_OTLP_HEADERS: optionalNonEmptyString,
  OTEL_SERVICE_NAME: optionalNonEmptyString,
  OTEL_SAMPLING_RATIO: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return value;
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number().min(0).max(1).default(1)),
  OTEL_RESOURCE_ATTRIBUTES: optionalNonEmptyString,
});

export function getConfig(): AppConfig {
  return loadConfig(process.env);
}

export function loadConfig(env: EnvSource): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid environment configuration: ${issues.join('; ')}`, issues);
  }

  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === 'production';
  const siteUrl = stripTrailingSlash(raw.SITE_URL);
  const portalUrl = stripTrailingSlash(raw.PORTAL_URL || raw.SITE_URL);
  const configuredCorsOrigins = parseOrigins(raw.CORS_ORIGINS || '');
  const adminOrigin = raw.ADMIN_ORIGIN ? stripTrailingSlash(raw.ADMIN_ORIGIN) : null;
  const portalOrigin = raw.PORTAL_ORIGIN ? stripTrailingSlash(raw.PORTAL_ORIGIN) : null;
  const productionCorsOrigins = uniqueStrings([...configuredCorsOrigins, adminOrigin, portalOrigin]);

  const config: AppConfig = {
    env: raw.NODE_ENV,
    isProduction,
    isTest: raw.NODE_ENV === 'test',
    logLevel: raw.LOG_LEVEL,
    ports: {
      api: raw.API_PORT,
      web: raw.WEB_PORT,
      admin: raw.ADMIN_PORT,
      portal: raw.PORTAL_PORT,
      workerHealth: raw.WORKER_HEALTH_PORT,
    },
    database: { url: raw.DATABASE_URL },
    redis: { url: raw.REDIS_URL },
    site: {
      url: siteUrl,
      portalUrl,
      apiUrl: raw.API_URL ? stripTrailingSlash(raw.API_URL) : null,
      name: raw.SITE_NAME,
      description: raw.SITE_DESCRIPTION,
      locale: raw.SITE_LOCALE,
    },
    cors: {
      origin: isProduction ? productionCorsOrigins : true,
      origins: productionCorsOrigins,
      staffAllowedOrigins: allowedOrigins(isProduction, ['http://localhost:7777', 'http://localhost:7780', 'http://127.0.0.1:7777', 'http://127.0.0.1:7780'], [adminOrigin, ...configuredCorsOrigins]),
      memberAllowedOrigins: allowedOrigins(isProduction, ['http://localhost:7777', 'http://localhost:7781', 'http://127.0.0.1:7777', 'http://127.0.0.1:7781'], [portalOrigin, ...configuredCorsOrigins]),
    },
    cookies: {
      staffSessionName: raw.SESSION_COOKIE_NAME,
      memberSessionName: raw.MEMBER_SESSION_COOKIE_NAME,
      secure: isProduction,
    },
    smtp: {
      host: raw.SMTP_HOST,
      port: raw.SMTP_PORT,
      secure: raw.SMTP_SECURE,
      user: raw.SMTP_USER || null,
      pass: raw.SMTP_PASS || raw.SMTP_PASSWORD || null,
      from: raw.SMTP_FROM,
    },
    email: { webhookSecret: raw.EMAIL_WEBHOOK_SECRET || null },
    newsletters: { unsubscribeSecret: raw.NEWSLETTER_UNSUBSCRIBE_SECRET || null },
    members: { signupEnabled: raw.MEMBERS_SIGNUP_ENABLED },
    billing: {
      stripeSecretKey: raw.STRIPE_SECRET_KEY || null,
      stripeWebhookSecret: raw.STRIPE_WEBHOOK_SECRET || null,
      portalUrl,
    },
    secrets: { encryptionKey: raw.VIBRESS_ENCRYPTION_KEY || null },
    outbox: {
      deliveryMode: raw.EVENT_DELIVERY_MODE,
      publishedRetentionDays: raw.OUTBOX_PUBLISHED_RETENTION_DAYS,
      failedRetentionDays: raw.OUTBOX_FAILED_RETENTION_DAYS,
    },
    system: {
      version: raw.VIBRESS_VERSION,
      storageProvider: raw.STORAGE_PROVIDER,
    },
    observability: {
      metricsEnabled: raw.METRICS_ENABLED,
      tracingEnabled: raw.TRACING_ENABLED,
      tracing: {
        otlpEndpoint: raw.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318',
        otlpHeaders: parseKeyValuePairs(raw.OTEL_EXPORTER_OTLP_HEADERS),
        serviceName: raw.OTEL_SERVICE_NAME || 'vibress',
        samplingRatio: raw.OTEL_SAMPLING_RATIO,
        resourceAttributes: parseKeyValuePairs(raw.OTEL_RESOURCE_ATTRIBUTES),
      },
    },
  };

  enforceProductionGuards(config);
  return config;
}

function enforceProductionGuards(config: AppConfig): void {
  if (!config.isProduction) return;
  const issues: string[] = [];
  if (!config.secrets.encryptionKey || config.secrets.encryptionKey.includes('change-me')) {
    issues.push('VIBRESS_ENCRYPTION_KEY must be set to a real production key');
  }
  if (!config.newsletters.unsubscribeSecret || config.newsletters.unsubscribeSecret === 'dev-unsub-secret') {
    issues.push('NEWSLETTER_UNSUBSCRIBE_SECRET must be set in production');
  }
  if (!config.billing.stripeSecretKey || config.billing.stripeSecretKey === 'sk_test_missing') {
    issues.push('STRIPE_SECRET_KEY must be set in production');
  }
  if (!config.billing.stripeWebhookSecret) {
    issues.push('STRIPE_WEBHOOK_SECRET must be set in production');
  }
  if (config.cors.origins.length === 0) {
    issues.push('CORS_ORIGINS, ADMIN_ORIGIN, or PORTAL_ORIGIN must define at least one production origin');
  }
  if (issues.length > 0) {
    throw new ConfigError(`Invalid production configuration: ${issues.join('; ')}`, issues);
  }
}

function allowedOrigins(isProduction: boolean, localDefaults: string[], configured: Array<string | null>): string[] {
  return uniqueStrings([...(isProduction ? [] : localDefaults), ...configured]);
}

function parseOrigins(value: string): string[] {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean).map(stripTrailingSlash);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value && value.trim().length > 0)));
}

function parseKeyValuePairs(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const result: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const val = trimmed.slice(equalsIndex + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

function isUrl(value: string): boolean {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
