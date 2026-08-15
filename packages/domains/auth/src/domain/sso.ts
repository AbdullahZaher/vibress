export type SsoProtocol = "saml2" | "oidc";

export interface SsoConfig {
  id: string;
  name: string;
  protocol: SsoProtocol;
  issuerUrl: string;
  clientId?: string | undefined;
  clientSecretEncrypted?: string | undefined;
  entryPoint?: string | undefined; // For SAML IdP URL
  certPem?: string | undefined; // For SAML signing cert
  enabled: boolean;
  autoProvision: boolean;
  defaultRole: string;
}

export interface SsoUserPayload {
  externalId: string;
  email: string;
  name: string;
  attributes?: Record<string, unknown> | undefined;
}

export interface SsoAuthUrlResult {
  url: string;
  state: string;
}

export interface SsoProvider {
  readonly protocol: SsoProtocol;
  getAuthorizationUrl(state: string, redirectUri: string): Promise<SsoAuthUrlResult>;
  validateCallback(callbackPayload: Record<string, unknown>): Promise<SsoUserPayload>;
}
