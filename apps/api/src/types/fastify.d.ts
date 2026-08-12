import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      name: string;
      slug?: string | null;
      status?: string;
    };
    roles?: string[];
    permissions?: string[];
    sessionToken?: string;
    member?: import('@vibress/members').Member;
    memberSessionToken?: string;
    machineAuth?: {
      keyId: string;
      name: string;
      scopes: string[];
    };
  }
}
