// Express route: /api/billing
//
// Phase 1: Entitlement + trial (read-only projection, trial start)
// Phase 2: Stripe Checkout + Webhook + Billing Portal (this file)
//
// The projection (computeEntitlement) is provider-agnostic: it derives
// access from status + timestamps. Stripe webhook writes the row; the
// projection reads it. Two clients, one rule.

import { Router } from 'express';
import type { Response, Request } from 'express';
import Stripe from 'stripe';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import type { AuthenticatedRequest } from '../middleware/auth';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { startCardTrial } from '../lib/trial';
import {
  NO_SUBSCRIPTION,
  computeEntitlement,
  type EntitlementView,
  type SubscriptionFacts,
} from '../lib/entitlement';
import {
  createCheckoutSession,
  createBillingPortalSession,
  constructWebhookEvent,
  invoiceSubscriptionId,
  mapStripeStatusToLocal,
  mapStripePriceToPlan,
  resolveFirstPaidAt,
  getStripe,
} from '../lib/stripe';
import { createCheckoutSessionRequest } from '@partyhause/core/contracts/billing';
import { validated } from '../lib/validate';

const router = Router();

const trialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) =>
    (req as AuthenticatedRequest).user?.id ?? ipKeyGenerator(req.ip ?? '') ?? 'unknown',
  message: { error: 'Too many attempts. Try again later.' },
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) =>
    (req as AuthenticatedRequest).user?.id ?? ipKeyGenerator(req.ip ?? '') ?? 'unknown',
  message: { error: 'Too many checkout attempts. Try again later.' },
});

export async function loadEntitlement(userId: string, now = new Date()): Promise<EntitlementView> {
  const [subscription, billableTurns] = await Promise.all([
    prisma.subscription.findUnique({
      where: { user_id: userId },
      select: {
        plan: true,
        status: true,
        source: true,
        card_trial_started_at: true,
        trial_ends_at: true,
        current_period_end: true,
        cancel_at_period_end: true,
        first_paid_at: true,
      },
    }),
    prisma.aiUsage.count({ where: { user_id: userId, source: 'llm' } }),
  ]);

  const facts: SubscriptionFacts = subscription ?? NO_SUBSCRIPTION;
  return computeEntitlement(facts, billableTurns, now);
}

router.get('/entitlement', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json(await loadEntitlement(req.user!.id));
  } catch (err) {
    console.error('[Billing] entitlement error:', err);
    res.status(500).json({ error: 'Failed to load entitlement' });
  }
});

router.post(
  '/trial/start',
  requireAuth,
  trialLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const result = await startCardTrial(prisma, userId);

      if (!result.ok) {
        return res.status(409).json({ error: result.message, code: result.code });
      }

      res.status(result.alreadyRunning ? 200 : 201).json({
        trial_ends_at: result.trialEndsAt,
        already_running: result.alreadyRunning,
        entitlement: await loadEntitlement(userId),
      });
    } catch (err) {
      console.error('[Billing] trial start error:', err);
      res.status(500).json({ error: 'Failed to start your trial' });
    }
  },
);

router.post(
  '/checkout',
  requireAuth,
  checkoutLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const body = validated(res, createCheckoutSessionRequest, req.body);
      if (!body) return;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, stripe_customer_id: true },
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const baseUrl = process.env.VITE_APP_URL ?? 'http://localhost:5173';
      const successUrl = body.success_url ?? `${baseUrl}/settings?billing=success`;
      const cancelUrl = body.cancel_url ?? `${baseUrl}/settings?billing=canceled`;

      const session = await createCheckoutSession({
        userId,
        email: user.email,
        plan: body.plan,
        successUrl,
        cancelUrl,
        customerId: user.stripe_customer_id ?? undefined,
      });

      if (!session.url) {
        throw new Error('Checkout session created without URL');
      }

      if (!user.stripe_customer_id && session.customer) {
        await prisma.user.update({
          where: { id: userId },
          data: { stripe_customer_id: session.customer as string },
        });
      }

      res.json({ session_id: session.id, url: session.url });
    } catch (err) {
      console.error('[Billing] checkout error:', err);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  },
);

router.post(
  '/portal',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { stripe_customer_id: true },
      });

      if (!user?.stripe_customer_id) {
        return res.status(400).json({ error: 'No billing account found' });
      }

      const baseUrl = process.env.VITE_APP_URL ?? 'http://localhost:5173';
      const returnUrl = `${baseUrl}/settings`;

      const session = await createBillingPortalSession({
        customerId: user.stripe_customer_id,
        returnUrl,
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('[Billing] portal error:', err);
      res.status(500).json({ error: 'Failed to create billing portal session' });
    }
  },
);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

router.post(
  '/webhook',
  async (req: Request, res: Response) => {
    if (!webhookSecret) {
      console.error('[Billing] Webhook secret not configured');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const signature = req.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    let event: Stripe.Event;
    try {
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body);
      event = constructWebhookEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error('[Billing] Webhook signature verification failed:', err);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    try {
      await handleStripeEvent(event);
      res.json({ received: true });
    } catch (err) {
      console.error('[Billing] Webhook handler error:', err);
      res.status(500).json({ error: 'Webhook handler failed' });
    }
  },
);

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const eventId = event.id;
  const eventType = event.type;

  const existing = await prisma.billingEvent.findUnique({
    where: { provider_provider_event_id: { provider: 'stripe', provider_event_id: eventId } },
  });

  if (existing) {
    if (existing.status === 'applied') {
      console.log(`[Billing] Event ${eventId} already applied, skipping`);
      return;
    }
    await prisma.billingEvent.update({
      where: { id: existing.id },
      data: { status: 'pending', error: null },
    });
  } else {
    const crypto = await import('crypto');
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
    await prisma.billingEvent.create({
      data: {
        provider: 'stripe',
        provider_event_id: eventId,
        event_type: eventType,
        payload_hash: payloadHash,
        status: 'pending',
      },
    });
  }

  try {
    switch (eventType) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        console.log(`[Billing] Unhandled event type: ${eventType}`);
    }

    await prisma.billingEvent.update({
      where: { provider_provider_event_id: { provider: 'stripe', provider_event_id: eventId } },
      data: { status: 'applied', applied_at: new Date() },
    });
  } catch (err) {
    await prisma.billingEvent.update({
      where: { provider_provider_event_id: { provider: 'stripe', provider_event_id: eventId } },
      data: { status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' },
    });
    throw err;
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id;
  const plan = session.metadata?.plan as 'creator' | 'vendor' | undefined;
  const subscriptionId = session.subscription as string;
  const customerId = session.customer as string;

  if (!userId || !plan) {
    console.warn('[Billing] Checkout session missing metadata', { sessionId: session.id });
    return;
  }

  const stripeSub = await getStripe().subscriptions.retrieve(subscriptionId);
  const priceId = stripeSub.items.data[0]?.price.id;
  const mappedPlan = mapStripePriceToPlan(priceId) ?? plan;
  const currentPeriodEnd = stripeSub.items.data[0]?.current_period_end;
  const now = new Date();

  // first_paid_at is write-once (server/lib/stripe.ts): a resubscribe after
  // a cancel must not move it, or "subscription ended" reads as "trial ended".
  const existing = await prisma.subscription.findUnique({
    where: { user_id: userId },
    select: { first_paid_at: true },
  });
  const firstPaidAt = resolveFirstPaidAt(existing?.first_paid_at, stripeSub.status, now);

  await prisma.subscription.upsert({
    where: { user_id: userId },
    update: {
      plan: mappedPlan,
      status: mapStripeStatusToLocal(stripeSub.status),
      source: 'stripe',
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      cancel_at_period_end: stripeSub.cancel_at_period_end,
      first_paid_at: firstPaidAt,
      revision: { increment: 1 },
    },
    create: {
      user_id: userId,
      plan: mappedPlan,
      status: mapStripeStatusToLocal(stripeSub.status),
      source: 'stripe',
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      cancel_at_period_end: stripeSub.cancel_at_period_end,
      first_paid_at: firstPaidAt ?? null,
    },
  });

  // Remember the customer on the user row the first time we learn it, so the
  // billing portal has something to open. Only when there is one to remember
  // and the row does not already hold one.
  if (customerId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripe_customer_id: true },
    });
    if (user && !user.stripe_customer_id) {
      await prisma.user.update({
        where: { id: userId },
        data: { stripe_customer_id: customerId },
      });
    }
  }

  console.log(`[Billing] Subscription created for user ${userId}: ${mappedPlan}`);
}

async function handleSubscriptionUpdated(stripeSub: Stripe.Subscription): Promise<void> {
  const userId = stripeSub.metadata?.user_id;
  const priceId = stripeSub.items.data[0]?.price.id;
  const plan = mapStripePriceToPlan(priceId);

  if (!userId || !plan) {
    console.warn('[Billing] Subscription missing user_id or unrecognized price', {
      subscriptionId: stripeSub.id,
      priceId,
    });
    return;
  }

  const currentPeriodEnd = stripeSub.items.data[0]?.current_period_end;
  const now = new Date();

  // Webhooks can arrive before the checkout handler has written the row
  // (or after it was deleted), so this is an upsert, not an update: a naked
  // update throws P2025, Stripe retries, and the retry fails the same way.
  const existing = await prisma.subscription.findUnique({
    where: { user_id: userId },
    select: { first_paid_at: true },
  });

  await prisma.subscription.upsert({
    where: { user_id: userId },
    update: {
      plan,
      status: mapStripeStatusToLocal(stripeSub.status),
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      cancel_at_period_end: stripeSub.cancel_at_period_end,
      first_paid_at: resolveFirstPaidAt(existing?.first_paid_at, stripeSub.status, now),
      revision: { increment: 1 },
    },
    create: {
      user_id: userId,
      plan,
      status: mapStripeStatusToLocal(stripeSub.status),
      source: 'stripe',
      stripe_customer_id: typeof stripeSub.customer === 'string' ? stripeSub.customer : null,
      stripe_subscription_id: stripeSub.id,
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      cancel_at_period_end: stripeSub.cancel_at_period_end,
      first_paid_at: stripeSub.status === 'active' ? now : null,
    },
  });

  console.log(`[Billing] Subscription updated for user ${userId}: ${plan} (${stripeSub.status})`);
}

async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription): Promise<void> {
  const userId = stripeSub.metadata?.user_id;
  if (!userId) {
    console.warn('[Billing] Deleted subscription missing user_id', { subscriptionId: stripeSub.id });
    return;
  }

  // A delete for an account with no subscription row is a no-op, not an
  // error: there is nothing to cancel, and an update here would throw P2025
  // on every Stripe retry.
  const existing = await prisma.subscription.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });
  if (!existing) {
    console.warn('[Billing] Deleted subscription has no local row; skipping', {
      subscriptionId: stripeSub.id,
    });
    return;
  }

  await prisma.subscription.update({
    where: { user_id: userId },
    data: {
      status: 'canceled',
      cancel_at_period_end: false,
      revision: { increment: 1 },
    },
  });

  console.log(`[Billing] Subscription canceled for user ${userId}`);
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const stripeSub = await getStripe().subscriptions.retrieve(subscriptionId);
  const userId = stripeSub.metadata?.user_id;
  if (!userId) return;

  const now = new Date();
  const currentPeriodEnd = stripeSub.items.data[0]?.current_period_end;

  // Upsert, not update, for the same out-of-order reason as
  // handleSubscriptionUpdated: the invoice can arrive before the row exists.
  // first_paid_at moves only from null, never from a stored timestamp.
  const existing = await prisma.subscription.findUnique({
    where: { user_id: userId },
    select: { first_paid_at: true },
  });

  await prisma.subscription.upsert({
    where: { user_id: userId },
    update: {
      status: 'active',
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      first_paid_at: resolveFirstPaidAt(existing?.first_paid_at, 'active', now),
      revision: { increment: 1 },
    },
    create: {
      user_id: userId,
      plan: mapStripePriceToPlan(stripeSub.items.data[0]?.price.id) ?? 'free',
      status: 'active',
      source: 'stripe',
      stripe_customer_id: typeof stripeSub.customer === 'string' ? stripeSub.customer : null,
      stripe_subscription_id: stripeSub.id,
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      first_paid_at: now,
    },
  });

  console.log(`[Billing] Payment succeeded for user ${userId}`);
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const stripeSub = await getStripe().subscriptions.retrieve(subscriptionId);
  const userId = stripeSub.metadata?.user_id;
  if (!userId) return;

  // Upsert, not update: a naked update throws P2025 when the row does not
  // exist yet, and Stripe retries the same failing delivery.
  await prisma.subscription.upsert({
    where: { user_id: userId },
    update: {
      status: 'past_due',
      revision: { increment: 1 },
    },
    create: {
      user_id: userId,
      plan: mapStripePriceToPlan(stripeSub.items.data[0]?.price.id) ?? 'free',
      status: 'past_due',
      source: 'stripe',
      stripe_customer_id: typeof stripeSub.customer === 'string' ? stripeSub.customer : null,
      stripe_subscription_id: stripeSub.id,
    },
  });

  console.log(`[Billing] Payment failed for user ${userId}`);
}

export default router;