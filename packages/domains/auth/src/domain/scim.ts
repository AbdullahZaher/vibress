export interface ScimUserResource {
  schemas: string[];
  id: string;
  userName: string;
  name: {
    givenName?: string;
    familyName?: string;
    formatted: string;
  };
  emails: Array<{ value: string; primary: boolean; type?: string }>;
  active: boolean;
  roles?: string[];
  meta: {
    resourceType: "User";
    created: string;
    lastModified: string;
  };
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  Resources: T[];
}

export function formatScimUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  status?: string;
  createdAt: Date;
  updatedAt: Date;
}): ScimUserResource {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    userName: user.email,
    name: {
      formatted: user.name,
    },
    emails: [
      {
        value: user.email,
        primary: true,
        type: "work",
      },
    ],
    active: user.status !== "disabled" && user.status !== "suspended",
    roles: [user.role],
    meta: {
      resourceType: "User",
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}
