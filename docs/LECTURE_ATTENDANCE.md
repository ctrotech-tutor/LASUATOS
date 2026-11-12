# Quick lecture attendance

The fastest way to take attendance. It does not need course offerings or enrolment.

## Who can take attendance

- **Lecturers** and **administrators**.
- **GHOC**: the general head of class for one faculty and one academic set (for example, Faculty of Engineering, 2023/2024 set). Appointed by an institution or faculty administrator.
- **HOC**: the head of class for one department and set. Appointed by an administrator or by the GHOC of that faculty and set.

Manage class reps at `/class-reps`. A student needs an account before being appointed.

## Taking attendance (`/sessions`)

1. Type the course code and title. Today's date is set automatically.
2. Choose how long attendance stays open (15 min to 3 hrs).
3. Choose the QR type:
   - **On a screen (dynamic)**: changes every 30 seconds with a 6-character code. Show it full screen on a projector, a TV or your phone.
   - **Printed poster (static)**: one fixed QR code and an 8-character code. Download the A4 PNG or print it. It works only while the session is open.
4. Optionally pick a venue and require students to be inside it (location is checked once).

The student list updates live. You can remove an entry (with a reason), restore it, extend by 15 minutes, close, reopen, switch the QR type, and export CSV for Excel. Entries made on the same phone as other students are flagged.

## Marking attendance (`/a`)

Students scan the QR code with their phone camera, or open `/a` and type the code.
- **Without an account**: they type their full name and matric number. These can be remembered on the phone.
- **Signed in**: one tap. Earlier guest entries with the same matric number are attached to the account.

Lectures marked this way appear under "Lectures you marked" on `/attendance`.

## Production

Migrations `0012`–`0014` must be applied before deploying: `pnpm prod:migrate`.
