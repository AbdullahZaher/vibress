-- C01: additive legacy CMS identity mapping.
--
-- A Publication remains a CMS business concept. This mapping records which
-- versioned Application/Installation instance owns an existing CMS
-- installation and inventories each publication without renaming or rewriting
-- any CMS identifier. `pub_default` is mapped as its own publication id and is
-- never substituted for an Application or Tenant identity.
--
-- Design: docs/platform-roadmap/LEGACY-CMS-IDENTITY-AND-MIGRATION.md
-- This migration is additive only and changes no historical migration.

CREATE TABLE public.platform_legacy_cms_installations (
  installation_id text PRIMARY KEY NOT NULL
    REFERENCES public.platform_installations(id) ON DELETE RESTRICT,
  application_id text NOT NULL UNIQUE
    REFERENCES public.platform_applications(id) ON DELETE RESTRICT,
  profile text NOT NULL DEFAULT 'LEGACY_CMS_IDENTITY_V1'
    CHECK (profile = 'LEGACY_CMS_IDENTITY_V1'),
  publication_count integer NOT NULL CHECK (publication_count >= 0),
  content_models integer NOT NULL CHECK (content_models >= 0),
  content_entries integer NOT NULL CHECK (content_entries >= 0),
  draft_entries integer NOT NULL CHECK (draft_entries >= 0),
  published_entries integer NOT NULL CHECK (published_entries >= 0),
  deleted_entries integer NOT NULL CHECK (deleted_entries >= 0),
  content_translations integer NOT NULL CHECK (content_translations >= 0),
  media_assets integer NOT NULL CHECK (media_assets >= 0),
  media_references integer NOT NULL CHECK (media_references >= 0),
  posts integer NOT NULL CHECK (posts >= 0),
  pages integer NOT NULL CHECK (pages >= 0),
  revisions integer NOT NULL CHECK (revisions >= 0),
  members integer NOT NULL CHECK (members >= 0),
  memberships integer NOT NULL CHECK (memberships >= 0),
  plans integer NOT NULL CHECK (plans >= 0),
  products integer NOT NULL CHECK (products >= 0),
  subscriptions integer NOT NULL CHECK (subscriptions >= 0),
  billing_customers integer NOT NULL CHECK (billing_customers >= 0),
  scheduled_newsletter_sends integer NOT NULL CHECK (scheduled_newsletter_sends >= 0),
  outbox_events integer NOT NULL CHECK (outbox_events >= 0),
  delayed_outbox_events integer NOT NULL CHECK (delayed_outbox_events >= 0),
  inventory_digest text NOT NULL CHECK (inventory_digest ~ '^[a-f0-9]{64}$'),
  mapped_by text NOT NULL CHECK (length(btrim(mapped_by)) > 0),
  mapped_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT platform_legacy_cms_installations_identity_unique
    UNIQUE (installation_id, application_id)
);

CREATE TABLE public.platform_legacy_cms_publications (
  publication_id text PRIMARY KEY NOT NULL
    REFERENCES public.publications(id) ON DELETE RESTRICT,
  installation_id text NOT NULL,
  application_id text NOT NULL,
  legacy_workspace_id text NOT NULL
    REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  legacy_slug text NOT NULL CHECK (length(btrim(legacy_slug)) > 0),
  primary_locale text NOT NULL CHECK (length(btrim(primary_locale)) > 0),
  content_models integer NOT NULL CHECK (content_models >= 0),
  content_entries integer NOT NULL CHECK (content_entries >= 0),
  draft_entries integer NOT NULL CHECK (draft_entries >= 0),
  published_entries integer NOT NULL CHECK (published_entries >= 0),
  deleted_entries integer NOT NULL CHECK (deleted_entries >= 0),
  content_translations integer NOT NULL CHECK (content_translations >= 0),
  media_assets integer NOT NULL CHECK (media_assets >= 0),
  media_references integer NOT NULL CHECK (media_references >= 0),
  posts integer NOT NULL CHECK (posts >= 0),
  pages integer NOT NULL CHECK (pages >= 0),
  revisions integer NOT NULL CHECK (revisions >= 0),
  members integer NOT NULL CHECK (members >= 0),
  memberships integer NOT NULL CHECK (memberships >= 0),
  plans integer NOT NULL CHECK (plans >= 0),
  products integer NOT NULL CHECK (products >= 0),
  subscriptions integer NOT NULL CHECK (subscriptions >= 0),
  billing_customers integer NOT NULL CHECK (billing_customers >= 0),
  scheduled_newsletter_sends integer NOT NULL CHECK (scheduled_newsletter_sends >= 0),
  outbox_events integer NOT NULL CHECK (outbox_events >= 0),
  delayed_outbox_events integer NOT NULL CHECK (delayed_outbox_events >= 0),
  publication_digest text NOT NULL CHECK (publication_digest ~ '^[a-f0-9]{64}$'),
  mapped_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT platform_legacy_cms_publications_installation_fk
    FOREIGN KEY (installation_id, application_id)
    REFERENCES public.platform_legacy_cms_installations (installation_id, application_id)
    ON DELETE RESTRICT
);

CREATE INDEX platform_legacy_cms_publications_installation_idx
  ON public.platform_legacy_cms_publications (installation_id);

-- Identity mappings are operator-provisioned. Ordinary runtime logins may be
-- granted reads, but a mapping change must never be an application operation.
CREATE FUNCTION public.platform_legacy_cms_identity_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  table_owner text;
  is_super boolean;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO table_owner
    FROM pg_catalog.pg_class c
    WHERE c.oid = TG_RELID;
  SELECT rolsuper INTO is_super
    FROM pg_catalog.pg_roles WHERE rolname = session_user;
  IF session_user IS DISTINCT FROM table_owner AND NOT COALESCE(is_super, false) THEN
    RAISE EXCEPTION 'only trusted DB provisioning may change legacy CMS identity mappings'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legacy CMS identity mappings are append-only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER platform_legacy_cms_installations_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_legacy_cms_installations
  FOR EACH ROW EXECUTE FUNCTION public.platform_legacy_cms_identity_guard();

CREATE TRIGGER platform_legacy_cms_publications_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_legacy_cms_publications
  FOR EACH ROW EXECUTE FUNCTION public.platform_legacy_cms_identity_guard();

REVOKE ALL ON FUNCTION public.platform_legacy_cms_identity_guard() FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_legacy_cms_installations FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_legacy_cms_publications FROM PUBLIC;

COMMENT ON TABLE public.platform_legacy_cms_installations IS
  'C01 additive mapping of one legacy multi-publication CMS installation to a versioned Application/Installation.';
COMMENT ON TABLE public.platform_legacy_cms_publications IS
  'C01 per-publication inventory. Publication ids remain CMS business identities, never Application or Tenant ids.';
