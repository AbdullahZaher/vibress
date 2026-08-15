import { SettingRepository, SettingDefinition, SettingNamespaceDefinition, SettingRecord, AuditRecorder } from '../domain/setting';
import { runInTransaction } from '@vibress/database';

export class SettingsDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Typed, namespaced setting schemas. Each namespace owns the meaning and
 * validation of its settings; this domain orchestrates persistence and API
 * exposure with explicit classification.
 */
export const SETTING_NAMESPACES: SettingNamespaceDefinition[] = [
  {
    namespace: 'site',
    settings: [
      { key: 'title', type: 'string', classification: 'public', default: 'Vibress' },
      { key: 'tagline', type: 'string', classification: 'public', default: '' },
      { key: 'description', type: 'string', classification: 'public', default: '' },
      {
        key: 'locale',
        type: 'string',
        classification: 'public',
        default: 'en',
        validate: (v) => (/^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/.test(String(v)) ? null : 'Invalid locale'),
      },
      {
        key: 'timezone',
        type: 'string',
        classification: 'public',
        default: 'UTC',
      },
      {
        key: 'accentColor',
        type: 'string',
        classification: 'public',
        default: '#6366f1',
        validate: (v) => (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v)) ? null : 'Invalid hex color'),
      },
      { key: 'iconUrl', type: 'string', classification: 'public', default: '' },
      { key: 'logoUrl', type: 'string', classification: 'public', default: '' },
      { key: 'coverUrl', type: 'string', classification: 'public', default: '' },
      {
        key: 'primaryNav',
        type: 'json',
        classification: 'public',
        default: [
          { id: '1', label: 'Home', url: '/' },
          { id: '2', label: 'Articles', url: '/posts' },
          { id: '3', label: 'Authors', url: '/authors' },
          { id: '4', label: 'About', url: '/pages/about' },
        ],
      },
      {
        key: 'secondaryNav',
        type: 'json',
        classification: 'public',
        default: [
          { id: '5', label: 'Privacy Policy', url: '/pages/privacy' },
          { id: '6', label: 'Terms of Service', url: '/pages/terms' },
        ],
      },
      { key: 'announcementEnabled', type: 'boolean', classification: 'public', default: false },
      { key: 'announcementText', type: 'string', classification: 'public', default: '' },
      { key: 'announcementUrl', type: 'string', classification: 'public', default: '' },
    ],
  },
  {
    namespace: 'publishing',
    settings: [
      { key: 'defaultPostStatus', type: 'string', classification: 'staff-visible', default: 'draft', validate: (v) => (['draft', 'published'].includes(String(v)) ? null : 'Invalid status') },
      { key: 'postsPerPage', type: 'number', classification: 'staff-visible', default: 10, validate: (v) => (Number(v) > 0 && Number(v) <= 100 ? null : 'Must be 1-100') },
    ],
  },
  {
    namespace: 'members',
    settings: [
      { key: 'signupEnabled', type: 'boolean', classification: 'staff-visible', default: true },
      { key: 'defaultNewsletterOptIn', type: 'boolean', classification: 'staff-visible', default: false },
    ],
  },
  {
    namespace: 'email',
    settings: [
      { key: 'fromName', type: 'string', classification: 'staff-visible', default: 'Vibress' },
      { key: 'fromEmail', type: 'string', classification: 'staff-visible', default: '', validate: (v) => (v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v)) ? null : 'Invalid email') },
      { key: 'smtpHost', type: 'string', classification: 'secret', default: '' },
      { key: 'smtpPassword', type: 'string', classification: 'secret', default: '' },
    ],
  },
  {
    namespace: 'billing',
    settings: [
      { key: 'currency', type: 'string', classification: 'staff-visible', default: 'USD', validate: (v) => (/^[A-Z]{3}$/.test(String(v)) ? null : 'Invalid currency') },
      { key: 'stripePublishableKey', type: 'string', classification: 'staff-visible', default: '' },
    ],
  },
  {
    namespace: 'storage',
    settings: [
      { key: 'maxUploadSizeMb', type: 'number', classification: 'staff-visible', default: 500, validate: (v) => (Number(v) > 0 && Number(v) <= 4096 ? null : 'Must be 1-4096') },
    ],
  },
  {
    namespace: 'integrations',
    settings: [
      { key: 'webhookRetryMax', type: 'number', classification: 'internal', default: 5, validate: (v) => (Number(v) >= 0 && Number(v) <= 20 ? null : 'Must be 0-20') },
    ],
  },
  {
    namespace: 'security',
    settings: [
      { key: 'isPrivate', type: 'boolean', classification: 'public', default: false },
      { key: 'passwordHash', type: 'string', classification: 'secret', default: '' },
      { key: 'memberSessionTtlHours', type: 'number', classification: 'staff-visible', default: 720, validate: (v) => (Number(v) >= 1 && Number(v) <= 8760 ? null : 'Must be 1-8760') },
      { key: 'authRateLimitPerMinute', type: 'number', classification: 'internal', default: 20, validate: (v) => (Number(v) >= 1 ? null : 'Must be positive') },
    ],
  },
  {
    namespace: 'analytics',
    settings: [
      { key: 'gaId', type: 'string', classification: 'public', default: '' },
      { key: 'plausibleDomain', type: 'string', classification: 'public', default: '' },
      { key: 'posthogKey', type: 'string', classification: 'public', default: '' },
      { key: 'posthogHost', type: 'string', classification: 'public', default: 'https://app.posthog.com' },
    ],
  },
  {
    namespace: 'comments',
    settings: [
      { key: 'commentAccess', type: 'string', classification: 'public', default: 'all', validate: (v) => (['all', 'paid', 'disabled'].includes(String(v)) ? null : 'Invalid comment access') },
      { key: 'preModeration', type: 'boolean', classification: 'staff-visible', default: false },
    ],
  },
  {
    namespace: 'code',
    settings: [
      { key: 'headerCode', type: 'string', classification: 'public', default: '' },
      { key: 'footerCode', type: 'string', classification: 'public', default: '' },
    ],
  },
];

const NAMESPACE_MAP = new Map(SETTING_NAMESPACES.map((ns) => [ns.namespace, ns]));

export class SettingsService {
  constructor(private repo: SettingRepository, private audit: AuditRecorder) {}

  listNamespaces(): string[] {
    return SETTING_NAMESPACES.map((ns) => ns.namespace);
  }

  /**
   * Returns a mask of the settings value based on classification.
   * 'secret' and 'internal' values are masked; 'public' and
   * 'staff-visible' are returned as-is.
   */
  maskForStaff(value: unknown, classification: string): unknown {
    if (classification === 'secret' || classification === 'internal') return '••••••••';
    return value;
  }

  /**
   * Public-safe settings: only 'public' classification values.
   */
  async getPublicSettings(): Promise<Record<string, Record<string, unknown>>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const ns of SETTING_NAMESPACES) {
      const stored = await this.repo.getMany(ns.namespace);
      const publicValues: Record<string, unknown> = {};
      for (const def of ns.settings) {
        if (def.classification !== 'public') continue;
        const storedSetting = stored.find((s) => s.key === def.key);
        publicValues[def.key] = storedSetting ? storedSetting.value : def.default;
      }
      if (Object.keys(publicValues).length > 0) result[ns.namespace] = publicValues;
    }
    return result;
  }

  /**
   * Staff-visible settings (masked secrets/internal). Values for missing
   * settings fall back to defaults.
   */
  async getStaffSettings(): Promise<Array<{ namespace: string; settings: Array<{ key: string; value: unknown; classification: string }> }>> {
    const result: Array<{ namespace: string; settings: Array<{ key: string; value: unknown; classification: string }> }> = [];
    for (const ns of SETTING_NAMESPACES) {
      const stored = await this.repo.getMany(ns.namespace);
      const values = ns.settings.map((def) => {
        const storedSetting = stored.find((s) => s.key === def.key);
        const raw = storedSetting ? storedSetting.value : def.default;
        return {
          key: def.key,
          value: this.maskForStaff(raw, def.classification),
          classification: def.classification,
        };
      });
      result.push({ namespace: ns.namespace, settings: values });
    }
    return result;
  }

  /**
   * Updates one setting within a namespace. Validates against the typed
   * schema, persists, and records an audit entry (without the raw value
   * when the setting is secret).
   */
  async updateSetting(namespace: string, key: string, value: unknown, actorId: string | null): Promise<SettingRecord> {
    return runInTransaction(() => this.updateSettingTx(namespace, key, value, actorId));
  }

  private async updateSettingTx(namespace: string, key: string, value: unknown, actorId: string | null): Promise<SettingRecord> {
    const ns = NAMESPACE_MAP.get(namespace);
    if (!ns) throw new SettingsDomainError('UNKNOWN_NAMESPACE', `Unknown settings namespace: ${namespace}`);
    const def = ns.settings.find((s) => s.key === key);
    if (!def) throw new SettingsDomainError('UNKNOWN_SETTING', `Unknown setting: ${namespace}.${key}`);

    // Type + validation
    const coerced = this.coerce(value, def);
    if (def.validate) {
      const error = def.validate(coerced);
      if (error) throw new SettingsDomainError('VALIDATION_ERROR', error);
    }

    const record = await this.repo.set({
      namespace,
      key,
      value: coerced,
      valueType: def.type,
      classification: def.classification,
      updatedBy: actorId,
    });

    // Audit: never log setting values (sensitive or not); only metadata
    await this.audit.record({
      actorUserId: actorId,
      action: 'setting.updated',
      targetType: 'setting',
      targetId: `${namespace}.${key}`,
      metadata: {
        classification: def.classification,
        changed: true,
      },
    });

    return record;
  }

  private coerce(value: unknown, def: SettingDefinition): unknown {
    switch (def.type) {
      case 'number': {
        const n = Number(value);
        if (isNaN(n)) throw new SettingsDomainError('VALIDATION_ERROR', `${def.key} must be a number`);
        return n;
      }
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        throw new SettingsDomainError('VALIDATION_ERROR', `${def.key} must be a boolean`);
      case 'json':
        if (typeof value === 'object' && value !== null) return value;
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            throw new SettingsDomainError('VALIDATION_ERROR', `${def.key} must be valid JSON`);
          }
        }
        throw new SettingsDomainError('VALIDATION_ERROR', `${def.key} must be JSON`);
      case 'string':
        return String(value ?? '');
      default:
        return value;
    }
  }
}
