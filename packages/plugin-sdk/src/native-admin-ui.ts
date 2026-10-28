/**
 * NUI-01 experimental types for a bounded, Host-rendered, read-only page.
 * These are inert declarative values, NOT an executable UI API. Current Hosts
 * do not admit or render them. The linked existing adminViews GET route remains
 * the sole potential data source in the future NUI-02 renderer.
 *
 * Do not add callbacks, URLs, HTML, CSS, modules, or authority selectors here.
 */
export interface PluginNativeAdminLocalizedLabelV1 {
  readonly en: string;
  readonly ar: string;
}

export interface PluginNativeAdminStatV1 {
  readonly type: "stat";
  readonly id: string;
  readonly label: PluginNativeAdminLocalizedLabelV1;
  /** A field declared by the existing linked Admin GET response shape. */
  readonly field: string;
}

export interface PluginNativeAdminFieldV1 {
  readonly key: string;
  readonly label: PluginNativeAdminLocalizedLabelV1;
}

export interface PluginNativeAdminFieldListV1 {
  readonly type: "field-list";
  readonly id: string;
  /** Every key must exist in the linked Admin GET response shape. */
  readonly fields: readonly PluginNativeAdminFieldV1[];
}

export type PluginNativeAdminComponentV1 =
  | PluginNativeAdminStatV1
  | PluginNativeAdminFieldListV1;

export interface PluginNativeAdminPageV1 {
  readonly schemaVersion: 1;
  /** Must reference a declared legacy adminViews ID; Host owns the URL. */
  readonly viewId: string;
  readonly title: PluginNativeAdminLocalizedLabelV1;
  readonly description?: PluginNativeAdminLocalizedLabelV1 | undefined;
  /** Read-only scalar projections; no tables, actions, or mutations in v1. */
  readonly components: readonly PluginNativeAdminComponentV1[];
}
