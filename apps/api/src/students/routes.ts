import { z } from 'zod';
import {
  ClassListEntryUpdateSchema,
  ClassListImportRequestSchema,
  ClassListLookupRequestSchema,
  FaceEnrollRequestSchema,
  FaceReplaceCodeRequestSchema,
  OpenAccountCodeRequestSchema,
  OpenAccountRequestSchema,
  StudentEmailCodeRequestSchema,
  StudentEmailVerifyRequestSchema,
} from '@lasuatos/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import { setSessionCookie, toAuthAccount } from '../auth/routes.js';
import { notAuthenticated, readSessionToken, unavailable } from '../attendance/route-helpers.js';
import { StudentError, type StudentService } from './service.js';

/** Class lists of up to 1,500 students. */
export const CLASS_LIST_BODY_LIMIT = 1024 * 1024;
/** Up to six camera photos of about 100–300 KB each, base64. */
export const FACE_BODY_LIMIT = 3 * 1024 * 1024;

const entryParams = z.object({ entryId: z.uuid() }).strict();
const listQuery = z.object({
  departmentId: z.uuid().optional(),
  entryYear: z.coerce.number().int().min(1950).max(2200).optional(),
}).strict();

/** Messages written for people (the contracts' own), as opposed to zod's generic ones. */
const HUMAN_MESSAGE = /^(Use|Enter|Add|The |Matric|Write|Check|Duplicate|Say)/;

const invalid = (message = 'Some details are missing or not valid.') => new StudentError(400, message);

/** The first problem with a request body, in words. */
function firstIssue(error: z.ZodError, fallback: string): string {
  const issue = error.issues[0];
  if (!issue) return fallback;
  // Messages written for people are kept; zod's generic ones are replaced.
  return HUMAN_MESSAGE.test(issue.message) ? issue.message : fallback;
}

export interface StudentRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly students?: StudentService;
  readonly secureCookies?: boolean;
}

export function registerStudentRoutes(server: FastifyInstance, options: StudentRouteOptions): void {
  async function requireAccount(request: FastifyRequest): Promise<AuthenticatedAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return account;
  }

  const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');
  const jpeg = (reply: FastifyReply, photo: Buffer) => reply
    .header('cache-control', 'private, no-store')
    .header('content-type', 'image/jpeg')
    .send(photo);

  /* ---------------- opening an account (public) ---------------- */

  server.post('/api/v1/students/lookup', async (request, reply) => {
    const body = ClassListLookupRequestSchema.safeParse(request.body);
    if (!body.success) throw new StudentError(422, 'Enter your matric number: 9 digits, e.g. 250211184.');
    if (!options.students) return unavailable(request, reply);
    return noStore(reply).send(await options.students.lookup(body.data.matricNumber));
  });

  server.post('/api/v1/students/open/code', async (request, reply) => {
    const body = OpenAccountCodeRequestSchema.safeParse(request.body);
    if (!body.success) throw new StudentError(422, firstIssue(body.error, 'Enter your matric number and LASU student email.'));
    if (!options.students) return unavailable(request, reply);
    return noStore(reply).send(await options.students.requestOpeningCode(body.data));
  });

  server.post('/api/v1/students/open', async (request, reply) => {
    const body = OpenAccountRequestSchema.safeParse(request.body);
    if (!body.success) throw new StudentError(422, firstIssue(body.error, 'Enter the 6-digit code from the email.'));
    if (!options.students || !options.auth) return unavailable(request, reply);
    const opened = await options.students.openAccount(body.data);
    const account = await options.auth.getSession(opened.token);
    if (account?.accountType !== 'student') throw new StudentError(500, 'Your account was opened. Sign in with your matric number and starting password.');
    setSessionCookie(reply, opened.token, account.sessionExpiresAt, options.secureCookies ?? false);
    return noStore(reply).code(201).send({
      status: 'opened',
      student: toAuthAccount(account),
      startingPassword: opened.startingPassword,
    });
  });

  /* ---------------- the signed-in student's setup ---------------- */

  server.get('/api/v1/students/me/setup', async (request, reply) => {
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.setup(account));
  });

  server.post('/api/v1/students/me/email-code', async (request, reply) => {
    const body = StudentEmailCodeRequestSchema.safeParse(request.body ?? {});
    if (!body.success) throw new StudentError(422, firstIssue(body.error, 'Use your LASU student email (…@st.lasu.edu.ng).'));
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.requestAccountEmailCode(account, body.data.email));
  });

  server.post('/api/v1/students/me/email-verify', async (request, reply) => {
    const body = StudentEmailVerifyRequestSchema.safeParse(request.body);
    if (!body.success) throw new StudentError(422, 'Enter the 6-digit code from the email.');
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.verifyAccountEmail(account, body.data.code));
  });

  server.post('/api/v1/students/me/face', { bodyLimit: FACE_BODY_LIMIT }, async (request, reply) => {
    const body = FaceEnrollRequestSchema.safeParse(request.body);
    if (!body.success) {
      const consent = body.error.issues.some((issue) => issue.path[0] === 'consent');
      throw new StudentError(422, consent ? 'Agree to the face notice first.' : 'Take all three photos: straight on, turned left and turned right.');
    }
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).code(201).send(await options.students.enrolFace(account, body.data.frames));
  });

  /* Taking new face photos: password + emailed code, then the photos. */

  server.post('/api/v1/students/me/face/replace/code', async (request, reply) => {
    const body = FaceReplaceCodeRequestSchema.safeParse(request.body);
    if (!body.success) throw new StudentError(422, 'Enter your password.');
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.requestFaceReplaceCode(account, body.data.password));
  });

  server.post('/api/v1/students/me/face/replace/confirm', async (request, reply) => {
    const body = StudentEmailVerifyRequestSchema.safeParse(request.body);
    if (!body.success) throw new StudentError(422, 'Enter the 6-digit code from the email.');
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.confirmFaceReplace(account, body.data.code));
  });

  server.post('/api/v1/students/me/face/replace', { bodyLimit: FACE_BODY_LIMIT }, async (request, reply) => {
    const body = FaceEnrollRequestSchema.safeParse(request.body);
    if (!body.success) {
      const consent = body.error.issues.some((issue) => issue.path[0] === 'consent');
      throw new StudentError(422, consent ? 'Agree to the face notice first.' : 'Take all three photos: straight on, turned left and turned right.');
    }
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.replaceFace(account, body.data.frames));
  });

  server.get('/api/v1/students/me/face/photo', async (request, reply) => {
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return jpeg(reply, await options.students.ownFacePhoto(account));
  });

  /* ---------------- class lists (HOCs, GHOCs, administrators) ---------------- */

  server.get('/api/v1/class-lists', async (request, reply) => {
    const query = listQuery.safeParse(request.query ?? {});
    if (!query.success) throw invalid();
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.classList(account, query.data));
  });

  server.post('/api/v1/class-lists/import', { bodyLimit: CLASS_LIST_BODY_LIMIT }, async (request, reply) => {
    const body = ClassListImportRequestSchema.safeParse(request.body);
    if (!body.success) {
      const issue = body.error.issues[0];
      const row = issue?.path[0] === 'rows' && typeof issue.path[1] === 'number' ? issue.path[1] + 1 : null;
      throw new StudentError(422, row
        ? `Row ${row}: ${HUMAN_MESSAGE.test(issue!.message) ? issue!.message : 'check the matric number and names.'}`
        : issue?.path[0] === 'rows' ? 'Add between 1 and 1,500 students.' : 'Choose the department and the set.');
    }
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.importClassList(account, body.data));
  });

  server.post('/api/v1/class-lists/entries/:entryId', async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    const body = ClassListEntryUpdateSchema.safeParse(request.body);
    if (!params.success) throw invalid();
    if (!body.success) throw new StudentError(422, firstIssue(body.error, 'Check the details and try again.'));
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return noStore(reply).send(await options.students.updateEntry(account, params.data.entryId, body.data));
  });

  server.post('/api/v1/class-lists/entries/:entryId/remove', async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    if (!params.success) throw invalid();
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    await options.students.removeEntry(account, params.data.entryId);
    return noStore(reply).send({ status: 'removed', id: params.data.entryId });
  });

  server.post('/api/v1/class-lists/entries/:entryId/reset-face', async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    if (!params.success) throw invalid();
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    await options.students.resetFace(account, params.data.entryId);
    return noStore(reply).send({ status: 'reset', id: params.data.entryId });
  });

  server.get('/api/v1/class-lists/entries/:entryId/photo', async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    if (!params.success) throw invalid();
    if (!options.students) return unavailable(request, reply);
    const account = await requireAccount(request);
    return jpeg(reply, await options.students.entryPhoto(account, params.data.entryId));
  });
}
