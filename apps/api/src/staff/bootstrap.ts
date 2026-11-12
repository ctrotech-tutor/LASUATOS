import { parseArgs } from 'node:util';
import { StaffInvitationCreateSchema, STAFF_ROLE_LABELS, type StaffInvitationCreate } from '@lasuatos/contracts';
import { fragmentLink } from '../email/transport.js';
import type { StaffRepository } from './repository.js';
import { StaffError, type StaffService } from './service.js';

/**
 * `pnpm admin:bootstrap` creates the first administrator invitation. It is the
 * only provisioning step that needs server access; everyone after that is
 * invited from the Staff page by an administrator.
 */

export const BOOTSTRAP_USAGE = `Usage: pnpm admin:bootstrap --email <address> --name "<full name>" [--scope institution|faculty|department]
                            [--faculty <code>] [--department <code>] [--institution <slug>] [--print-link]

  --scope        institution (default), faculty (needs --faculty) or department (needs --department)
  --institution  institution slug (default: SELF_REGISTRATION_INSTITUTION_SLUG)
  --print-link   also print the invitation link (it is always printed when no email could be sent)`;

export interface BootstrapRequest {
  readonly institutionSlug: string;
  readonly email: string;
  readonly displayName: string;
  readonly scope: 'institution' | 'faculty' | 'department';
  readonly unitCode: string | null;
  readonly printLink: boolean;
}

export function parseBootstrapArguments(argv: readonly string[], defaultInstitutionSlug: string): BootstrapRequest {
  const { values } = parseArgs({
    args: [...argv].filter((value) => value !== '--'),
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      scope: { type: 'string', default: 'institution' },
      faculty: { type: 'string' },
      department: { type: 'string' },
      institution: { type: 'string' },
      'print-link': { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (!values.email || !values.name) throw new Error('Both --email and --name are required.');
  const scope = values.scope;
  if (scope !== 'institution' && scope !== 'faculty' && scope !== 'department') {
    throw new Error('--scope must be institution, faculty or department.');
  }
  const unitCode = scope === 'faculty' ? values.faculty : scope === 'department' ? values.department : undefined;
  if (scope !== 'institution' && !unitCode) throw new Error(`--scope ${scope} needs --${scope} <code>.`);
  return {
    institutionSlug: values.institution ?? defaultInstitutionSlug,
    email: values.email,
    displayName: values.name,
    scope,
    unitCode: unitCode ?? null,
    printLink: values['print-link'],
  };
}

export interface BootstrapOutcome {
  readonly email: string;
  readonly roleLabel: string;
  readonly scopeLabel: string;
  readonly expiresAt: string;
  readonly emailSent: boolean;
  /** Present only when it should be shown to the operator. */
  readonly link: string | null;
}

export async function runBootstrap(
  request: BootstrapRequest,
  dependencies: { readonly staff: Pick<StaffService, 'bootstrap'>; readonly repository: StaffRepository; readonly publicAppUrl: string },
): Promise<BootstrapOutcome> {
  let facultyId: string | null = null;
  let departmentId: string | null = null;
  if (request.scope !== 'institution') {
    const institution = await dependencies.repository.findInstitution(request.institutionSlug);
    if (!institution) throw new StaffError(404, 'institution_not_found', `No institution with slug "${request.institutionSlug}".`);
    const id = await dependencies.repository.findUnitIdByCode(institution.id, request.scope, request.unitCode!);
    if (!id) throw new StaffError(404, 'unit_not_found', `No ${request.scope} with code "${request.unitCode}".`);
    if (request.scope === 'faculty') facultyId = id;
    else departmentId = id;
  }

  const role = `${request.scope}_administrator` as const;
  const input: StaffInvitationCreate = StaffInvitationCreateSchema.parse({
    email: request.email,
    displayName: request.displayName,
    role,
    facultyId,
    departmentId,
  });
  const issued = await dependencies.staff.bootstrap(request.institutionSlug, input);
  const showLink = request.printLink || !issued.emailSent;
  return {
    email: issued.invitation.email,
    roleLabel: STAFF_ROLE_LABELS[role],
    scopeLabel: issued.invitation.scopeLabel,
    expiresAt: issued.invitation.expiresAt,
    emailSent: issued.emailSent,
    link: showLink ? fragmentLink(dependencies.publicAppUrl, '/accept-invitation', issued.token) : null,
  };
}
