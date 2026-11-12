-- Completes the LASU Faculty of Engineering with all six departments.
--
-- Data only, and conservative:
--   * runs only where the institution `lasu` has a Faculty of Engineering (code ENG,
--     or named "Faculty of Engineering"); everywhere else (local demo, tests) it does nothing;
--   * adds a department only if no department in the institution already has its code,
--     or a name that matches once "Department of", "&"/"and", case and punctuation are ignored;
--   * never renames, moves or deletes anything, so departments edited by administrators keep
--     their names, and running `pnpm prod:institution:setup` later stays safe.
WITH engineering AS (
  SELECT f.id AS faculty_id, f.institution_id
  FROM faculties f
  JOIN institutions i ON i.id = f.institution_id
  WHERE i.slug = 'lasu'
    AND (upper(f.code) = 'ENG' OR lower(f.name) = 'faculty of engineering')
  ORDER BY (upper(f.code) = 'ENG') DESC, f.created_at
  LIMIT 1
),
wanted (code, name) AS (
  VALUES
    ('AAE', 'Department of Aeronautical and Astronautical Engineering'),
    ('CPE', 'Department of Chemical and Polymer Engineering'),
    ('CVE', 'Department of Civil Engineering'),
    ('ECE', 'Department of Electronic and Computer Engineering'),
    ('ISE', 'Department of Industrial and Systems Engineering'),
    ('MEE', 'Department of Mechanical Engineering')
)
INSERT INTO departments (institution_id, faculty_id, code, name, is_active, programme_years)
SELECT e.institution_id, e.faculty_id, w.code, w.name, true, 5
FROM engineering e
CROSS JOIN wanted w
WHERE NOT EXISTS (
  SELECT 1
  FROM departments d
  WHERE d.institution_id = e.institution_id
    AND (
      upper(d.code) = w.code
      OR regexp_replace(regexp_replace(replace(lower(d.name), '&', 'and'), '^department of ', ''), '[^a-z]', '', 'g')
       = regexp_replace(regexp_replace(lower(w.name), '^department of ', ''), '[^a-z]', '', 'g')
    )
)
ON CONFLICT DO NOTHING;
