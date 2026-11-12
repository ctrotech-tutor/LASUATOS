'use client';

import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ */
/* In-app dialogs and toasts.                                          */
/*                                                                     */
/* The app's own confirm / prompt / toast (never the browser's), as   */
/* match the app: a centred card on desktop, a bottom sheet on phones. */
/* Built on <dialog>.showModal(), so focus trapping, Escape and the    */
/* top layer come from the browser.                                    */
/* ------------------------------------------------------------------ */

type Tone = 'default' | 'danger';

export interface ConfirmOptions {
  readonly title: string;
  readonly body?: ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: Tone;
}

export interface PromptOptions extends ConfirmOptions {
  readonly label: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  /** Quick answers shown as chips under the field. */
  readonly suggestions?: readonly string[];
}

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

interface FeedbackApi {
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** Resolves to the typed text, or null when cancelled. */
  prompt(options: PromptOptions): Promise<string | null>;
  toast(message: string, kind?: ToastKind): void;
}

type Pending =
  | { readonly kind: 'confirm'; readonly options: ConfirmOptions; readonly resolve: (value: boolean) => void }
  | { readonly kind: 'prompt'; readonly options: PromptOptions; readonly resolve: (value: string | null) => void };

const FeedbackContext = createContext<FeedbackApi | null>(null);

/**
 * Every page renders inside FeedbackProvider (see AppShell), so the browser's own
 * alert/confirm/prompt are never used. Outside it, fail loudly in development.
 */
export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error('useFeedback must be used inside <FeedbackProvider>.');
  return api;
}

export function FeedbackProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const api = useMemo<FeedbackApi>(() => ({
    confirm: (options) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', options, resolve })),
    prompt: (options) => new Promise<string | null>((resolve) => setPending({ kind: 'prompt', options, resolve })),
    toast: (message, kind = 'success') => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-2), { id, kind, message }]);
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 6000 : 3500);
    },
  }), [dismissToast]);

  const settle = useCallback((value: boolean | string | null) => {
    setPending((current) => {
      if (current?.kind === 'confirm') current.resolve(Boolean(value));
      if (current?.kind === 'prompt') current.resolve(typeof value === 'string' ? value : null);
      return null;
    });
  }, []);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {pending ? <FeedbackDialog key={pending.options.title} pending={pending} onSettle={settle} /> : null}
      <div className="ui-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`ui-toast is-${toast.kind}`} key={toast.id}>
            {toast.kind === 'success' ? <CheckCircle2 size={18} aria-hidden="true" /> : toast.kind === 'error' ? <AlertTriangle size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}
            <span>{toast.message}</span>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss"><X size={16} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

function FeedbackDialog({ pending, onSettle }: Readonly<{ pending: Pending; onSettle: (value: boolean | string | null) => void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { options } = pending;
  const [text, setText] = useState(pending.kind === 'prompt' ? pending.options.defaultValue ?? '' : '');

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSettle(pending.kind === 'prompt' ? text.trim() : true);
  }

  return (
    <dialog
      ref={ref}
      className={`ui-dialog${options.tone === 'danger' ? ' is-danger' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onSettle(pending.kind === 'prompt' ? null : false); }}
      onClick={(event) => { if (event.target === ref.current) onSettle(pending.kind === 'prompt' ? null : false); }}
    >
      <form className="ui-dialog-card" onSubmit={submit}>
        <span className="ui-dialog-grip" aria-hidden="true" />
        <h2 id={titleId}>{options.title}</h2>
        {options.body ? <div className="ui-dialog-body">{options.body}</div> : null}
        {pending.kind === 'prompt' ? (
          <div className="ui-dialog-field">
            <label className="account-field">
              <span>{pending.options.label}</span>
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={pending.options.placeholder}
                maxLength={pending.options.maxLength ?? 200}
                autoFocus
              />
            </label>
            {pending.options.suggestions?.length ? (
              <div className="ui-dialog-chips">
                {pending.options.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className={`lx-chip-button${text === suggestion ? ' is-selected' : ''}`}
                    onClick={() => setText(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="ui-dialog-actions">
          <button className="button button-secondary" type="button" onClick={() => onSettle(pending.kind === 'prompt' ? null : false)}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button className={`button ${options.tone === 'danger' ? 'ui-button-danger' : 'button-primary'}`} type="submit" autoFocus={pending.kind === 'confirm'}>
            {options.confirmLabel ?? 'Continue'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
