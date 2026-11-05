-- The admin audit log is append-only: rows can be added, never changed or removed
CREATE FUNCTION admin.audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin.audit_log is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON admin.audit_log
  FOR EACH ROW EXECUTE FUNCTION admin.audit_log_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON admin.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION admin.audit_log_append_only();