import { paywallCopy, type PaywallReason } from '@partyhause/core';
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PastelCard } from '@/components/ui/PastelCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Sparkles, 
  Send, 
  Bot, 
  User, 
  Wand2, 
  Check,
  Edit3,
  ChevronRight,
  ArrowLeft,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { apiPost } from '@/lib/api-client';

const generateId = () => crypto.randomUUID();

/**
 * Server limits, mirrored from server/lib/event-chat.ts.
 *
 * Duplicated deliberately. Importing them would pull a server module into the
 * client bundle, and the alternative, letting the server reject an oversized
 * conversation with a 400, turns a recoverable UI state into a dead end mid
 * planning session.
 */
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/**
 * The extraction contract, mirroring ExtractedEventData in
 * server/lib/event-extraction.ts.
 */
interface ExtractedEventData {
  templateId?: string;
  eventName?: string;
  description?: string;
  eventDate?: string;
  eventTime?: string;
  location?: string;
  expectedGuests?: number;
  budget?: number;
  theme?: string;
  specialRequests?: string;
  formData?: Record<string, any>;
}

/** The body of a 200 from POST /api/ai/chat (server/routes/ai.ts:60). */
interface ChatTurnResult {
  reply: string;
  extracted: ExtractedEventData;
  /** True once the planner has the core fields; this is what opens the review step. */
  complete: boolean;
  source: 'llm' | 'heuristic';
}

interface AIEventAssistantProps {
  onComplete: (data: ExtractedEventData) => void;
  onBack: () => void;
  initialTemplate?: string;
}

const WELCOME_MESSAGE = `Hi! I'm your AI Event Planner. 

Instead of filling out long forms, just tell me about your event in your own words. For example:

• "I'm planning a 30th birthday party for about 20 friends. I want a rooftop venue with cocktails and a DJ. Budget is around $2000."

• "We need to organize a team offsite for 15 people. Thinking of a day retreat with workshops and team building activities."

• "My daughter is turning 5 and loves unicorns. Need a kids party with games, face painting, and a bounce house."

What kind of event are you planning?`;

export default function AIEventAssistant({ 
  onComplete, 
  onBack,
  initialTemplate 
}: AIEventAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: WELCOME_MESSAGE,
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * True once the server has refused a turn for payment.
   *
   * Separate from `error` because it is not one: the product is working
   * exactly as designed and the user has a next step, which is not true of a
   * timeout or a rate limit.
   */
  const [quotaSpent, setQuotaSpent] = useState<PaywallReason | null | false>(false);
  const [startingTrial, setStartingTrial] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedEventData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  /**
   * Send the conversation to the planner and append its reply.
   *
   * This used to be `setTimeout(1500)` around a local function that matched
   * keywords with `String.includes` and pulled numbers out with two regexes.
   * It never made a network call. The word "AI" on the button was decoration,
   * and the extraction it produced was wrong often enough to be worse than an
   * empty form: `/\$?(\d+,?\d*)/` matched the "30" in "30th birthday" and
   * called it a $30 budget.
   *
   * `/api/ai/chat` has existed the whole time, complete with an Azure OpenAI
   * layer, a chrono-node date parser, a weighted template lexicon and a
   * deterministic fallback for when no LLM is configured. It had zero callers.
   */
  /**
   * Start the trial from the wall, then carry on the turn that was refused.
   *
   * The refused message is still in the composer's history, so a successful
   * start drops the wall and the user retries in place rather than being sent
   * somewhere else to buy and then having to find their way back.
   */
  const handleStartTrial = async () => {
    setStartingTrial(true);
    const { error: trialError } = await apiPost('/api/billing/trial/start');
    setStartingTrial(false);

    if (trialError) {
      // 409 means the account is already past this: already subscribed, or the
      // trial has been used. Neither is retryable here and both need the
      // billing screen, so say so rather than leaving a button that does
      // nothing when pressed.
      setError(
        trialError.status === 409
          ? 'This account has already used its trial. Manage your subscription in Settings.'
          : 'Could not start the trial. You can still fill the form in yourself.',
      );
      return;
    }

    setQuotaSpent(false);
    setError(null);
  };

  /**
   * Leave the wall without paying, keeping the work.
   *
   * Hands whatever the assistant extracted in the free turns to the manual
   * form. `onBack` would discard it, which punishes the user for having hit a
   * limit we set.
   */
  const handleDismissWall = () => {
    onComplete(extractedData ?? {});
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    if (trimmed.length > MAX_MESSAGE_CHARS) {
      setError(`That message is too long. Keep it under ${MAX_MESSAGE_CHARS.toLocaleString()} characters.`);
      return;
    }

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    const history = [...messages, userMessage];

    // The server accepts at most MAX_MESSAGES entries and rejects the whole
    // request otherwise. Trimming the oldest turns here keeps a long planning
    // session working instead of failing it with a 400 at turn 41.
    const wireMessages = history
      .slice(-MAX_MESSAGES)
      .map(({ role, content }) => ({ role, content }));

    setMessages(history);
    setInput('');
    setError(null);
    setIsProcessing(true);

    const { data, error: apiError } = await apiPost<{ success: boolean; data: ChatTurnResult }>(
      '/api/ai/chat',
      { messages: wireMessages },
    );

    setIsProcessing(false);

    if (apiError || !data?.data) {
      // 402 is not an error, it is the wall.
      //
      // The route answers 402 PAYMENT_REQUIRED with a paywall reason when the
      // free turns are spent (server/routes/ai.ts). Treating it as a failure
      // showed the user "the planner could not be reached", which is both
      // untrue and unactionable: nothing is broken, they have simply used
      // their three turns. The reason selects the copy, which is why the
      // server sends one rather than a bare boolean.
      if (apiError?.status === 402) {
        setQuotaSpent((apiError as { paywall?: { reason?: PaywallReason } })?.paywall?.reason ?? null);
        setError(null);
        return;
      }

      // Every other failure path is named. A silent catch here would leave the
      // user watching a spinner that already stopped.
      setError(
        apiError?.status === 429
          ? 'The planner is rate limited right now. Wait a few minutes, or skip ahead and fill the form in yourself.'
          : apiError?.message || 'The planner could not be reached. You can skip ahead and fill the form in yourself.',
      );
      return;
    }

    const turn = data.data;

    setMessages((prev) => [
      ...prev,
      { id: generateId(), role: 'assistant', content: turn.reply, timestamp: new Date() },
    ]);

    if (turn.complete && turn.extracted) {
      // initialTemplate is an explicit choice the user already made on the
      // previous step, so it outranks whatever the planner inferred.
      setExtractedData({
        ...turn.extracted,
        templateId: initialTemplate || turn.extracted.templateId,
      });
      setShowPreview(true);
    }
  };

  const handleEditData = () => {
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    setIsEditing(false);
  };

  const handleConfirm = () => {
    if (extractedData) {
      onComplete(extractedData);
    }
  };

  const updateExtractedField = (field: keyof ExtractedEventData, value: any) => {
    if (extractedData) {
      setExtractedData({ ...extractedData, [field]: value });
    }
  };

  if (showPreview && extractedData) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <PastelCard variant="peach">
          <CardHeader className="bg-gradient-to-r from-orange-50 to-pink-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-pink-500 rounded-full flex items-center justify-center">
                <Wand2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">AI-Generated Event Details</CardTitle>
                <p className="text-sm text-gray-600">Review and edit before continuing</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Event Name</Label>
                  <Input
                    value={extractedData.eventName || ''}
                    onChange={(e) => updateExtractedField('eventName', e.target.value)}
                    placeholder="Event name"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Description</Label>
                  <Textarea
                    value={extractedData.description || ''}
                    onChange={(e) => updateExtractedField('description', e.target.value)}
                    placeholder="Event description"
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium">Expected Guests</Label>
                    <Input
                      type="number"
                      value={extractedData.expectedGuests || ''}
                      onChange={(e) => updateExtractedField('expectedGuests', parseInt(e.target.value) || undefined)}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Budget ($)</Label>
                    <Input
                      type="number"
                      value={extractedData.budget || ''}
                      onChange={(e) => updateExtractedField('budget', parseInt(e.target.value) || undefined)}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Template</Label>
                  <select
                    className="w-full p-2 border rounded-md"
                    value={extractedData.templateId}
                    onChange={(e) => updateExtractedField('templateId', e.target.value)}
                  >
                    <option value="birthday">Birthday Party (Adult)</option>
                    <option value="kids-birthday">Kids Birthday</option>
                    <option value="wedding">Wedding</option>
                    <option value="conference">Conference</option>
                    <option value="product-launch">Product Launch</option>
                    <option value="fundraiser">Fundraiser</option>
                    <option value="festival">Festival</option>
                    <option value="travel">Group Travel</option>
                    <option value="block-party">Block Party</option>
                    <option value="workshop">Workshop/Class</option>
                    <option value="hackathon">Hackathon</option>
                  </select>
                </div>
                <Button onClick={handleSaveEdit} className="w-full">
                  <Check className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-gray-600">Template Type</span>
                    <span className="font-medium capitalize">{extractedData.templateId?.replace(/-/g, ' ')}</span>
                  </div>
                  {extractedData.eventName && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-gray-600">Event Name</span>
                      <span className="font-medium">{extractedData.eventName}</span>
                    </div>
                  )}
                  {extractedData.expectedGuests && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-gray-600">Expected Guests</span>
                      <span className="font-medium">{extractedData.expectedGuests}</span>
                    </div>
                  )}
                  {extractedData.budget && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-gray-600">Budget</span>
                      <span className="font-medium">${extractedData.budget.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="py-2">
                    <span className="text-gray-600 block mb-1">Description</span>
                    <p className="text-sm bg-gray-50 p-3 rounded">{extractedData.description}</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={handleEditData} className="flex-1">
                    <Edit3 className="w-4 h-4 mr-2" />
                    Edit Details
                  </Button>
                  <Button onClick={handleConfirm} className="flex-1 bg-gradient-to-r from-orange-500 to-pink-500">
                    <Check className="w-4 h-4 mr-2" />
                    Looks Good!
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </PastelCard>

        <Button variant="ghost" onClick={onBack} className="w-full">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Chat
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto h-[600px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-pink-500 rounded-full flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">AI Event Planner</h2>
            <p className="text-sm text-gray-500">Just chat naturally about your event</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
      </div>

      {/* Messages */}
      <PastelCard variant="lavender" className="flex-1 mb-4 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4">
            <div className="space-y-4">
              <AnimatePresence>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      message.role === 'assistant'
                        ? 'bg-gradient-to-br from-orange-500 to-pink-500'
                        : 'bg-gray-200'
                    }`}>
                      {message.role === 'assistant' ? (
                        <Bot className="w-4 h-4 text-white" />
                      ) : (
                        <User className="w-4 h-4 text-gray-600" />
                      )}
                    </div>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 whitespace-pre-line ${
                      message.role === 'assistant'
                        ? 'bg-gray-100 text-gray-800 rounded-tl-none'
                        : 'bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-tr-none'
                    }`}>
                      {message.content}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isProcessing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm text-gray-600">Thinking...</span>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </ScrollArea>
      </PastelCard>

      {/* A failed turn has to be visible. Without this the spinner simply stops
          and the user retypes the same message into the same failure. */}
      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">{error}</p>
        </div>
      )}

      {/* The wall, in place of the composer.
          Leaving the input enabled under a wall invites the user to type a
          message that will be refused, which reads as the product being
          broken rather than as a limit they have reached. */}
      {quotaSpent !== false ? (
        <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-pink-50 p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900">{paywallCopy(quotaSpent).title}</h3>
              <p className="mt-1 text-sm text-gray-600">{paywallCopy(quotaSpent).body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={handleStartTrial}
                  disabled={startingTrial}
                  className="bg-gradient-to-r from-orange-500 to-pink-500"
                >
                  {startingTrial ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    paywallCopy(quotaSpent).cta
                  )}
                </Button>
                {/* Every wall in this product has an exit. The planner is an
                    accelerator on a form that still works; a wall with no way
                    past it converts a user who was not paying today into a
                    user who leaves. */}
                <Button variant="ghost" onClick={handleDismissWall}>
                  {paywallCopy(quotaSpent).dismiss}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Describe your event..."
          className="flex-1"
          disabled={isProcessing}
        />
        <Button 
          onClick={handleSend} 
          disabled={!input.trim() || isProcessing}
          className="bg-gradient-to-r from-orange-500 to-pink-500"
        >
          {isProcessing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
      )}

      <p className="text-xs text-center text-gray-500 mt-2">
        Press Enter to send • The AI will gather details and fill out forms for you
      </p>
    </div>
  );
}

// Simple Label component since we need it
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={`block text-sm font-medium text-gray-700 mb-1 ${className || ''}`}>{children}</label>;
}
