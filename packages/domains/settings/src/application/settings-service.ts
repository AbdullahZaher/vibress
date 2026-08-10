import { SettingRepository, SettingDefinition, SettingNamespaceDefinition, SettingRecord, AuditRecorder } from '../domain/setting';

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
      { key: 'memberSessionTtlHours', type: 'number', classification: 'staff-visible', default: 720, validate: (v) => (Number(v) >= 1 && Number(v) <= 8760 ? null : 'Must be 1-8760') },
      { key: 'authRateLimitPerMinute', type: 'number', classification: 'internal', default: 20, validate: (v) => (Number(v) >= 1 ? null : 'Must be positive') },
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
        if (typeof value === 'object') return value;
        throw new SettingsDomainError('VALIDATION_ERROR', `${def.key} must be JSON`);
      case 'string':
        return String(value ?? '');
      default:
        return value;
    }
  }
}
