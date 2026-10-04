/**
 * Permanent account deletion, for the web.
 *
 * The server routes, the shared client resource and the mobile screen have all
 * existed since the account surface was written. `src/` had no deletion
 * control at all, so a user who registered on the web could not delete their
 * account from the web. Now that RSVP requires an account, every guest has one.
 *
 * TWO STAGES, AND WHY NEITHER IS DECORATIVE
 *   reauth  The password is checked against the live account and returns a
 *           receipt that expires. A session left open on a shared machine is
 *           not proof of identity for an irreversible action.
 *   confirm The receipt plus a typed word. The word is sent as-is and the
 *           server decides whether it matches, so there is one arbiter rather
 *           than a client check the server also has to repeat.
 *
 * A dead receipt returns the user to the password stage instead of leaving a
 * confirm button on screen that can only fail.
 */

import { useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DELETION_CONFIRMATION_WORD,
  accountService,
  receiptIsDead,
  type AccountDeletion,
} from '@/lib/account';

type Stage = 'idle' | 'reauth' | 'confirm' | 'done';

interface StageFormProps {
  value: string;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
}

/**
 * Stage one: prove it is you.
 *
 * Split out because the parent held both stage forms inline and ran to 171
 * lines. Each stage is a self-contained form over one field, so the split is
 * along a real seam rather than an arbitrary line count.
 */
function ReauthStage({ value, onChange, onCancel, onSubmit, busy }: StageFormProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="delete-password">Confirm your password</Label>
        <Input
          id="delete-password"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Your current password"
        />
      </div>
      <StageActions
        busy={busy}
        onCancel={onCancel}
        onSubmit={onSubmit}
        submitLabel="Continue"
        disabled={value.length === 0}
      />
    </div>
  );
}

/** Stage two: type the word the server demands. */
function ConfirmStage({ value, onChange, onCancel, onSubmit, busy }: StageFormProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground">
        Type <strong>{DELETION_CONFIRMATION_WORD}</strong> to erase this account.
      </p>
      <div className="space-y-1">
        <Label htmlFor="delete-confirmation">Confirmation</Label>
        <Input
          id="delete-confirmation"
          value={value}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          placeholder={DELETION_CONFIRMATION_WORD}
        />
      </div>
      <StageActions
        busy={busy}
        onCancel={onCancel}
        onSubmit={onSubmit}
        submitLabel="Delete permanently"
        disabled={value.length === 0}
      />
    </div>
  );
}

interface StageActionsProps {
  busy: boolean;
  disabled: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
}

/** Cancel and confirm, identical on both stages. */
function StageActions({ busy, disabled, submitLabel, onCancel, onSubmit }: StageActionsProps) {
  return (
    <div className="flex gap-2">
      <Button type="button" variant="ghost" className="flex-1" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button
        type="button"
        className="flex-1 bg-[#c02a16] text-white hover:bg-[#972317]"
        onClick={onSubmit}
        disabled={busy || disabled}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
      </Button>
    </div>
  );
}

interface DeleteAccountCardProps {
  /**
   * Called once the account is gone, to clear the session and leave the
   * authenticated area. The component does not navigate by itself: this app
   * reaches its pages through both a router table and a `currentPage` string,
   * and a component that picks one of them is wrong on the other.
   */
  onDeleted: () => void;
}

export function DeleteAccountCard({ onDeleted }: DeleteAccountCardProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deletion, setDeletion] = useState<AccountDeletion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStage('idle');
    setPassword('');
    setConfirmation('');
    setDeletion(null);
    setError(null);
  };

  const startReauth = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await accountService.createDeletionIntent(password);
    setBusy(false);

    if (result.error || !result.data) {
      setError(result.error);
      return;
    }
    // The password is not kept past the point it is needed.
    setPassword('');
    setDeletion(result.data);
    setStage('confirm');
  };

  const confirmDelete = async () => {
    if (busy || !deletion) return;
    setBusy(true);
    setError(null);

    const result = await accountService.confirmDeletion(deletion.receipt, confirmation);
    setBusy(false);

    if (result.error || !result.data) {
      setError(result.error);
      // An expired or unknown receipt cannot be retried. Leaving the confirm
      // button on screen would offer an action that can only fail, so the flow
      // returns to the password step, which is the only way to get a new one.
      if (receiptIsDead(result.code)) {
        setDeletion(null);
        setConfirmation('');
        setStage('reauth');
      }
      return;
    }

    setStage('done');
    onDeleted();
  };

  if (stage === 'done') {
    return (
      <Card className="border-[#e12d33]/30">
        <CardContent className="p-4">
          <p className="font-medium text-foreground">Your account has been deleted.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Signing you out now. Your events and guest lists have been removed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[#e12d33]/30">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-[#fceded]">
            <AlertTriangle className="h-5 w-5 text-[#e12d33]" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-foreground">Delete account</p>
            <p className="text-xs text-muted-foreground">
              Permanent. Your events, guest lists and RSVPs are removed and cannot be restored.
            </p>
          </div>
        </div>

        {stage === 'idle' && (
          <Button
            type="button"
            variant="outline"
            className="w-full border-[#e12d33]/40 text-[#972317] hover:bg-[#fceded]"
            onClick={() => {
              setStage('reauth');
              setError(null);
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete my account
          </Button>
        )}

        {stage === 'reauth' && (
          <ReauthStage
            value={password}
            onChange={setPassword}
            onCancel={reset}
            onSubmit={startReauth}
            busy={busy}
          />
        )}

        {stage === 'confirm' && (
          <ConfirmStage
            value={confirmation}
            onChange={setConfirmation}
            onCancel={reset}
            onSubmit={confirmDelete}
            busy={busy}
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-[#972317]">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
