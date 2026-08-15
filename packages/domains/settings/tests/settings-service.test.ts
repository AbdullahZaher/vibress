import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SettingsService } from '../src/application/settings-service';
import { SettingRepository, SettingRecord, AuditRecorder } from '../src/domain/setting';

beforeAll(() => {
  process.env.VIBRESS_ENCRYPTION_KEY = process.env.VIBRESS_ENCRYPTION_KEY || 'test-encryption-key-for-batch-14';
});

function makeRecord(overrides: Partial<SettingRecord> = {}): SettingRecord {
  return {
    id: 'site.title',
    namespace: 'site',
    key: 'title',
    value: 'Vibress',
    valueType: 'string',
    classification: 'public',
    updatedBy: null,
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('SettingsService', () => {
  const repo: SettingRepository = {
    get: vi.fn(async () => null),
    getMany: vi.fn(async () => []),
    set: vi.fn(async (r) => makeRecord({ namespace: r.namespace, key: r.key, value: r.value, valueType: r.valueType, classification: r.classification })),
    delete: vi.fn(async () => undefined),
  };
  const audit: AuditRecorder = { record: vi.fn(async () => undefined) };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new SettingsService(
      (overrides.repo as SettingRepository) || repo,
      (overrides.audit as AuditRecorder) || audit,
    );
  }

  it('updates a valid typed setting', async () => {
    const service = makeService();
    const record = await service.updateSetting('site', 'title', 'New Title', 'u1');
    expect(record.value).toBe('New Title');
    expect(repo.set).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'site', key: 'title', classification: 'public' }));
  });

  it('rejects an unknown namespace', async () => {
    const service = makeService();
    await expect(service.updateSetting('nope', 'title', 'x', null))
      .rejects.toMatchObject({ code: 'UNKNOWN_NAMESPACE' });
  });

  it('rejects an unknown setting key', async () => {
    const service = makeService();
    await expect(service.updateSetting('site', 'nope', 'x', null))
      .rejects.toMatchObject({ code: 'UNKNOWN_SETTING' });
  });

  it('rejects an invalid value per schema validation', async () => {
    const service = makeService();
    await expect(service.updateSetting('publishing', 'postsPerPage', 0, null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.updateSetting('publishing', 'defaultPostStatus', 'banana', null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.updateSetting('email', 'fromEmail', 'not-an-email', null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('coerces numbers and booleans', async () => {
    const service = makeService();
    const record = await service.updateSetting('publishing', 'postsPerPage', '25', null);
    expect(record.value).toBe(25);
    const boolRecord = await service.updateSetting('members', 'signupEnabled', 'false', null);
    expect(boolRecord.value).toBe(false);
  });

  it('updates extended site branding and navigation settings', async () => {
    const service = makeService();
    const color = await service.updateSetting('site', 'accentColor', '#10b981', 'u1');
    expect(color.value).toBe('#10b981');

    const tz = await service.updateSetting('site', 'timezone', 'Asia/Riyadh', 'u1');
    expect(tz.value).toBe('Asia/Riyadh');

    const nav = await service.updateSetting('site', 'primaryNav', JSON.stringify([{ label: 'Home', url: '/' }]), 'u1');
    expect(nav.value).toEqual([{ label: 'Home', url: '/' }]);

    const announce = await service.updateSetting('site', 'announcementEnabled', true, 'u1');
    expect(announce.value).toBe(true);
  });

  it('updates security settings (isPrivate, passwordHash)', async () => {
    const service = makeService();
    const isPrivate = await service.updateSetting('security', 'isPrivate', true, 'u1');
    expect(isPrivate.value).toBe(true);

    const hash = await service.updateSetting('security', 'passwordHash', 'argon2id$hashed', 'u1');
    expect(hash.value).toBe('argon2id$hashed');
  });

  it('updates analytics, comments, and code injection settings', async () => {
    const service = makeService();
    const ga = await service.updateSetting('analytics', 'gaId', 'G-1234567890', 'u1');
    expect(ga.value).toBe('G-1234567890');

    const comments = await service.updateSetting('comments', 'commentAccess', 'paid', 'u1');
    expect(comments.value).toBe('paid');

    const code = await service.updateSetting('code', 'headerCode', '<script>console.log(1);</script>', 'u1');
    expect(code.value).toBe('<script>console.log(1);</script>');
  });

  it('masks secret and internal values for staff', async () => {
    const service = makeService();
    expect(service.maskForStaff('smtp-secret', 'secret')).toBe('••••••••');
    expect(service.maskForStaff(5, 'internal')).toBe('••••••••');
    expect(service.maskForStaff('visible', 'staff-visible')).toBe('visible');
    expect(service.maskForStaff('public', 'public')).toBe('public');
  });

  it('getPublicSettings only returns public classification', async () => {
    const repoWith: SettingRepository = {
      ...repo,
      getMany: vi.fn(async (namespace) => {
        if (namespace === 'site') return [makeRecord({ value: 'Public Title' })];
        return [];
      }),
    };
    const service = makeService({ repo: repoWith });
    const publicSettings = await service.getPublicSettings();
    expect(publicSettings.site.title).toBe('Public Title');
    // email namespace (all staff-visible/secret) not present
    expect(publicSettings.email).toBeUndefined();
  });

  it('getStaffSettings masks secrets', async () => {
    const repoWith: SettingRepository = {
      ...repo,
      getMany: vi.fn(async (namespace) => {
        if (namespace === 'email') return [makeRecord({ namespace: 'email', key: 'smtpHost', value: 'real-smtp.example.com', classification: 'secret' })];
        return [];
      }),
    };
    const service = makeService({ repo: repoWith });
    const staff = await service.getStaffSettings();
    const emailNs = staff.find((n) => n.namespace === 'email');
    const smtp = emailNs!.settings.find((s) => s.key === 'smtpHost');
    expect(smtp!.value).toBe('••••••••');
    expect(JSON.stringify(staff)).not.toContain('real-smtp.example.com');
  });

  it('audit entries are recorded for changes (no raw secret values)', async () => {
    const auditWith: AuditRecorder = { record: vi.fn(async () => undefined) };
    const service = makeService({ audit: auditWith });
    await service.updateSetting('site', 'title', 'Audited Title', 'u1');
    expect(auditWith.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'setting.updated',
      targetType: 'setting',
      targetId: 'site.title',
    }));
    const meta = (auditWith.record as any).mock.calls[0][0].metadata;
    expect(JSON.stringify(meta)).not.toContain('Audited Title');
  });
});
