'use client';

import { ChevronLeft, Download, ExternalLink, FileText, Image as ImageIcon, Paperclip, Reply, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { loadAttachment, loadMessage } from '../../lib/lasu-mail/gmail';
import {
  bodyOf, decodeBase64Url, formatSize, header, initials, lasuSender, linkify, mailDocument, parseAddress, parseAddressList, sanitizeHtml,
  type GmailMessage, type MailAttachment,
} from '../../lib/lasu-mail/message';
import { Button, buttonClassName, EmptyState, SkeletonLines } from '../ds';
import { gmailLink, longDate, safeFileName } from './format';

type Loaded = { readonly id: string; readonly message: GmailMessage } | { readonly id: string; readonly error: string };

/** One email: who sent it (and whether LASU vouches for it), the body in a sandboxed frame, its files. */
export function MailReader({ id, token, mailbox, onClose, onError }: Readonly<{
  id: string;
  token: string;
  mailbox: string | null;
  onClose: () => void;
  /** Turns a failure into words, or null when it is handled (an expired token reconnects). */
  onError: (error: unknown) => string | null;
}>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadMessage(token, id, controller.signal)
      .then((message) => setLoaded({ id, message }))
      .catch((error: unknown) => {
        const text = onError(error);
        if (text) setLoaded({ id, error: text });
      });
    return () => controller.abort();
  }, [id, token, onError, attempt]);

  // Screen readers and keyboards land on the subject once it opens.
  const ready = loaded && 'message' in loaded;
  useEffect(() => {
    if (ready) heading.current?.focus({ preventScroll: true });
  }, [ready]);

  const back = (
    <button type="button" className="ml-back" onClick={onClose}>
      <ChevronLeft size={20} strokeWidth={2.2} aria-hidden="true" />
      Back to emails
    </button>
  );

  if (!loaded) {
    return (
      <article className="ml-reader" aria-busy="true">
        {back}
        <SkeletonLines lines={6} label="Opening email" />
      </article>
    );
  }
  if ('error' in loaded) {
    return (
      <article className="ml-reader">
        {back}
        <EmptyState error title="This email didn’t open" message={loaded.error} action={<Button variant="tinted" onClick={() => { setLoaded(null); setAttempt((value) => value + 1); }}>Try again</Button>} />
      </article>
    );
  }
  return <Message message={loaded.message} token={token} mailbox={mailbox} back={back} heading={heading} onError={onError} />;
}

function Message({ message, token, mailbox, back, heading, onError }: Readonly<{
  message: GmailMessage;
  token: string;
  mailbox: string | null;
  back: ReactNode;
  heading: RefObject<HTMLHeadingElement | null>;
  onError: (error: unknown) => string | null;
}>) {
  const payload = message.payload;
  const from = parseAddress(header(payload, 'From') || 'Unknown sender');
  const to = parseAddressList(header(payload, 'To'));
  const cc = parseAddressList(header(payload, 'Cc'));
  const subject = header(payload, 'Subject').trim() || '(no subject)';
  const date = Number(message.internalDate ?? 0) || Date.parse(header(payload, 'Date')) || 0;
  const trust = lasuSender(from, payload?.headers?.filter((item) => item.name.toLowerCase() === 'authentication-results').map((item) => item.value).join('; ') ?? '');
  const body = useMemo(() => bodyOf(payload), [payload]);
  const files = body.attachments.filter((file) => !file.inline);
  const recipients = [...to, ...cc];

  return (
    <article className="ml-reader" aria-labelledby="ml-subject">
      {back}
      <h2 className="ml-reader-subject" id="ml-subject" tabIndex={-1} ref={heading}>{subject}</h2>
      {trust === 'suspicious' ? (
        <div className="ml-notice is-danger" role="note">
          <ShieldAlert size={18} aria-hidden="true" />
          <span><strong>This may not be from LASU.</strong> It uses a LASU address, but Google could not confirm LASU sent it. Never share your password or codes because of an email like this.</span>
        </div>
      ) : null}
      <header className="ml-reader-head">
        <span className={`ml-avatar is-large${trust === 'verified' ? ' is-lasu' : ''}`} aria-hidden="true">{initials(from.name)}</span>
        <div className="ml-reader-who">
          <p className="ml-reader-from">
            <span className="ml-reader-name">{from.name}</span>
            {trust === 'verified' ? <span className="ml-verified"><ShieldCheck size={14} aria-hidden="true" />LASU</span> : null}
          </p>
          {from.name !== from.email ? <p className="ml-reader-address">{from.email}</p> : null}
          {recipients.length ? (
            <p className="ml-reader-to">
              To {recipients.slice(0, 3).map((item) => (mailbox && item.email === mailbox ? 'me' : item.name)).join(', ')}
              {recipients.length > 3 ? ` and ${recipients.length - 3} more` : ''}
            </p>
          ) : null}
        </div>
        <time className="ml-reader-date" dateTime={date ? new Date(date).toISOString() : undefined}>{longDate(date)}</time>
      </header>

      <Body message={message} token={token} onError={onError} />

      {files.length ? (
        <section className="ml-files" aria-labelledby="ml-files-title">
          <h3 className="ml-files-title" id="ml-files-title"><Paperclip size={15} aria-hidden="true" /> {files.length === 1 ? '1 attachment' : `${files.length} attachments`}</h3>
          <ul className="ml-files-list">
            {files.map((file) => <AttachmentRow key={file.partId} file={file} messageId={message.id} token={token} onError={onError} />)}
          </ul>
        </section>
      ) : null}

      <div className="ml-reader-actions">
        <a className={buttonClassName({ variant: 'tinted' })} href={gmailLink(mailbox, message.id)} target="_blank" rel="noopener noreferrer">
          <Reply size={18} aria-hidden="true" />
          Reply in Gmail
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>
      <p className="ml-reader-note">LASUATOS only reads. Reading here doesn’t mark the email as read in Gmail.</p>
    </article>
  );
}

/** The HTML in a sandboxed frame that grows to fit; plain text as text, with links. */
function Body({ message, token, onError }: Readonly<{ message: GmailMessage; token: string; onError: (error: unknown) => string | null }>) {
  const body = useMemo(() => bodyOf(message.payload), [message.payload]);
  const [remoteImages, setRemoteImages] = useState(false);
  const [inline, setInline] = useState<Readonly<Record<string, string>>>({});
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  const safe = useMemo(() => (body.html ? sanitizeHtml(body.html, { remoteImages }) : null), [body.html, remoteImages]);

  // Pictures sent inside the email (cid:) come from its own parts.
  useEffect(() => {
    if (!safe?.inlineImages.length) return undefined;
    const controller = new AbortController();
    const wanted = body.attachments.filter((file) => file.contentId && safe.inlineImages.includes(file.contentId) && file.mimeType.startsWith('image/'));
    void Promise.all(wanted.map(async (file) => {
      const bytes = file.data ? decodeBase64Url(file.data) : file.attachmentId ? await loadAttachment(token, message.id, file.attachmentId, controller.signal) : new Uint8Array();
      return [file.contentId!, `data:${file.mimeType};base64,${toBase64(bytes)}`] as const;
    })).then((pairs) => setInline(Object.fromEntries(pairs))).catch((error: unknown) => { onError(error); });
    return () => controller.abort();
  }, [safe, body.attachments, token, message.id, onError]);

  const html = useMemo(() => {
    if (!safe) return null;
    let content = safe.html;
    for (const [cid, url] of Object.entries(inline)) {
      content = content.split(`data-cid="${cid}"`).join(`data-cid="${cid}" src="${url}"`);
    }
    return mailDocument(content);
  }, [safe, inline]);

  useEffect(() => {
    const element = frame.current;
    if (!element || !html) return undefined;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const doc = element.contentDocument;
      if (!doc?.documentElement) return;
      setHeight(Math.max(80, Math.ceil(doc.documentElement.scrollHeight) + 4));
    };
    const onLoad = () => {
      measure();
      const doc = element.contentDocument;
      if (doc?.body && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(doc.body);
      }
      // Pictures change the height as they arrive.
      for (const image of Array.from(doc?.images ?? [])) image.addEventListener('load', measure);
    };
    element.addEventListener('load', onLoad);
    if (element.contentDocument?.readyState === 'complete' && element.contentDocument.body?.childElementCount) onLoad();
    return () => {
      element.removeEventListener('load', onLoad);
      observer?.disconnect();
    };
  }, [html]);

  if (html && safe) {
    return (
      <div className="ml-body">
        {safe.blockedImages > 0 ? (
          <div className="ml-images">
            <ImageIcon size={16} aria-hidden="true" />
            <span>Pictures from the web are hidden so the sender can’t tell when you read this.</span>
            <button type="button" className="ml-link-button" onClick={() => setRemoteImages(true)}>Show pictures</button>
          </div>
        ) : null}
        <iframe
          ref={frame}
          className="ml-frame"
          title="Email content"
          // No scripts ever run inside; same-origin only lets this page measure the height.
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={html}
          style={{ height }}
        />
      </div>
    );
  }
  const text = body.text ?? message.snippet ?? '';
  return (
    <div className="ml-body ml-text">
      {text.trim() ? linkify(text).map((piece, index) => ('href' in piece
        ? <a key={index} href={piece.href} target="_blank" rel="noopener noreferrer">{piece.text}</a>
        : <span key={index}>{piece.text}</span>)) : <span className="ml-muted">This email has no text.</span>}
    </div>
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

function AttachmentRow({ file, messageId, token, onError }: Readonly<{ file: MailAttachment; messageId: string; token: string; onError: (error: unknown) => string | null }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const bytes = file.data ? decodeBase64Url(file.data) : file.attachmentId ? await loadAttachment(token, messageId, file.attachmentId) : new Uint8Array();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: file.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = safeFileName(file.filename);
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (problem) {
      setError(onError(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="ml-file">
      <span className="ml-file-icon" aria-hidden="true"><FileText size={18} /></span>
      <span className="ml-file-body">
        <span className="ml-file-name">{file.filename}</span>
        <span className="ml-file-size">{formatSize(file.size)}{error ? <span className="ml-file-error" role="alert"> · {error}</span> : null}</span>
      </span>
      <Button variant="gray" size="sm" busy={busy} onClick={() => { void save(); }} icon={<Download size={16} />} aria-label={`Download ${file.filename}`}>Download</Button>
    </li>
  );
}
