-- P05/R1 cooperative actor-writer transaction fence (DISPOSABLE PG16 ONLY).
-- Must be loaded AFTER unchanged migrations 0059/0060 and BEFORE any plan/
-- approval is created. SECURITY INVOKER, no runtime/operator actor DML grants.
CREATE FUNCTION public.s03_test_actor_xact_fence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $actor$
DECLARE k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('vibress_m03s03_actor'),
      pg_catalog.hashtext(NEW.login_name));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('vibress_m03s03_actor'),
      pg_catalog.hashtext(OLD.login_name));
    RETURN OLD;
  ELSE
    FOR k IN SELECT DISTINCT a.login
      FROM pg_catalog.unnest(ARRAY[OLD.login_name,NEW.login_name]) AS a(login)
      ORDER BY a.login
    LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(k));
    END LOOP;
    RETURN NEW;
  END IF;
END $actor$;

CREATE TRIGGER s03_test_actor_xact_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.platform_schema_trusted_actors
FOR EACH ROW EXECUTE FUNCTION public.s03_test_actor_xact_fence();

REVOKE ALL ON FUNCTION public.s03_test_actor_xact_fence() FROM PUBLIC;
