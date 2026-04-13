-- ============================================================
-- Plan 13 — Public Demos
-- Adds is_demo / demo_slug columns to projects + a SECURITY DEFINER
-- helper that child-table RLS policies use for fast demo checks.
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_demo   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS demo_slug TEXT;

-- Slug must be unique across all demo projects. Partial index: non-demo
-- projects never participate in the uniqueness check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_demo_slug
  ON projects(demo_slug)
  WHERE is_demo = true;

-- Helper: is the given project a public demo?
--
-- SECURITY DEFINER means the function runs as the function owner (service
-- role) and bypasses RLS on the projects table. Without this, an anonymous
-- user's RLS-scoped SELECT on projects would return zero rows, the helper
-- would return false, and child-table demo policies would reject their own
-- reads — a chicken-and-egg failure.
--
-- STABLE lets Postgres cache the result across a single query.
CREATE OR REPLACE FUNCTION is_demo_project(p_project_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = p_project_id
      AND is_demo = true
  );
$$;

REVOKE ALL ON FUNCTION is_demo_project(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_demo_project(TEXT) TO anon, authenticated, service_role;
