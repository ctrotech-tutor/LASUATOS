# LASU administration

LASUATOS is scoped to Lagos State University. Its first academic area is the Faculty of Engineering. Academic departments, course offerings, and administrator scopes are organized beneath LASU so additional LASU faculties can be added without introducing other institution choices into the product.

## Administrator access

Administrators use the same sign-in page as students and lecturers. After password verification, the API reads the active role assignment from PostgreSQL and opens the administrator workspace for that account. There is no administrator sign-up form or client-side role selector.

Supported administrator scopes are:

- Institution administrator — LASU-wide academic overview
- Faculty administrator — overview limited to the assigned LASU faculty
- Department administrator — overview limited to the assigned LASU department

System-wide administrator roles are intentionally not exposed in the LASU application. Access must be provisioned through an authorized server-side process and remains subject to active account status, verified email, session validity, and the current role assignment. Removing or suspending the role prevents administrator session access on the next request. The current account contract presents one scope, so provision one active administrator scope per account. If legacy data contains several assignments, the narrowest active scope is resolved first (department, then faculty, then institution) with a stable ID ordering; this is not a scope-selection mechanism.

## Workspace overview

`GET /api/v1/admin/overview` returns active department, student, lecturer, course-offering, and enrollment counts. Every count is filtered using the administrator identity resolved from the HttpOnly session cookie. The endpoint does not accept role, institution, faculty, department, or account identifiers from the browser. Responses are private and are not cached.

The workspace is read-only. Academic structure changes, lecturer provisioning, and official student-record imports still require an authorized institutional workflow. The roster preflight at `/setup/roster` is an operator utility, not a product-facing import workflow; it only reads the selected CSV in the browser.

## Provisioning notes

Do not add administrator role assignment to public registration or accept it from a client request. An authorized provisioning process must create an active LASU user, complete account verification, and insert a correctly scoped row in `user_role_assignments`. Database constraints require the role and scope to match and require faculty/department records to belong to the same institution. Provisioning should be reviewed and audited before any connected LASU records are used.
