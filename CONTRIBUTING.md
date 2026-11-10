# Contributing

## Working agreements

- Keep changes focused and preserve the existing workspace boundaries.
- Use strict TypeScript and validated API inputs.
- Put authorization in server-side handlers and domain services, never only in the interface.
- Prefer explicit names and small modules over clever abstractions.
- Do not add student or staff data, credentials, venue coordinates or realistic-looking production records to the repository.
- Keep documentation aligned with what is implemented. Mark future work as planned.
- Use plain, direct interface copy. Avoid unsupported claims about identity, location certainty, compliance or product capability.
- Use timezone-aware database timestamps and `Africa/Lagos` for institution-local display unless the institution configuration says otherwise.
- Review generated migrations before applying them. Never change an applied migration in place.
- Avoid Unicode em dashes in interface and documentation copy.

## Before opening a change

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

If a change needs a PostgreSQL instance, use a dedicated development or test database. Never test migrations against production.

## Adding a dependency

Confirm that the dependency is maintained, compatible with the pinned Node and framework versions, and necessary for the feature. Prefer a small standard library or existing package when that meets the need. Update the lockfile and document any material architectural decision.

## Security-sensitive changes

Changes to identity, role scope, attendance records, location evidence, QR challenges, reports or audit events require tests for unauthorized access and failure behavior. Do not add a credential, biometric method, campus integration or institutional dataset without the appropriate owner and approval.
