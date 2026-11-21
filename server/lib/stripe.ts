/**
 * Stripe client and utilities.
 *
 * Initialized lazily so the module can be imported without a secret key
 * during build/test. All functions that use Stripe check for initialization.
 */

import Stripe from 'stripe';
import { STRIPE_PRICE_IDS } from '@partyhause/core/contracts/billing';

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    stripe = new Stripe(secretKey, {
      apiVersion: '2026-08-26.dahlia',
      typescript: true,
    });
  }
  return stripe;
}

export function getPriceId(plan: 'creator' | 'vendor'): string {
  const priceId = STRIPE_PRICE_IDS[plan];
  if (!priceId) {
    throw new Error(`Stripe price ID not configured for plan: ${plan}`);
  }
  return priceId;
}

export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  plan: 'creator' | 'vendor';
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
}): Promise<Stripe.Checkout.Session> {
  const stripeClient = getStripe();
  const priceId = getPriceId(params.plan);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer_email: params.customerId ? undefined : params.email,
    customer: params.customerId,
    metadata: {
      user_id: params.userId,
      plan: params.plan,
    },
    subscription_data: {
      metadata: {
        user_id: params.userId,
        plan: params.plan,
      },
    },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    automatic_tax: { enabled: true },
  };

  return stripeClient.checkout.sessions.create(sessionParams);
}

export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  const stripeClient = getStripe();
  return stripeClient.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
  const stripeClient = getStripe();
  try {
    return await stripeClient.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripeClient = getStripe();
  return stripeClient.subscriptions.cancel(subscriptionId);
}

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  const stripeClient = getStripe();
  return stripeClient.webhooks.constructEvent(payload, signature, webhookSecret);
}

export function mapStripeStatusToLocal(stripeStatus: Stripe.Subscription.Status): string {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'incomplete':
    case 'incomplete_expired':
      return 'expired';
    case 'unpaid':
      return 'past_due';
    case 'paused':
      return 'canceled';
    default:
      return 'expired';
  }
}

export function mapStripePriceToPlan(priceId: string | undefined): 'creator' | 'vendor' | null {
  if (!priceId) return null;
  if (priceId === STRIPE_PRICE_IDS.creator) return 'creator';
  if (priceId === STRIPE_PRICE_IDS.vendor) return 'vendor';
  return null;
}

/**
 * The subscription behind an invoice, or null when the invoice is not tied
 * to one (one-off invoice, quote parent).
 *
 * Stripe moved this off the invoice top level into
 * `parent.subscription_details` and the types no longer carry a `subscription`
 * field at all, so the old `(invoice as any).subscription` cast read
 * undefined on every invoice and silently dropped all invoice webhooks.
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === 'string' ? sub : sub.id;
}

/**
 * first_paid_at is write-once: the first time real money was taken, ever.
 * It separates "your subscription ended" from "your trial ended", so no
 * webhook handler may move it once set. Returns undefined when the stored
 * value must be left untouched (Prisma treats undefined as "do not write"),
 * the current time when this event is the first paid conversion, and null
 * when there is still nothing to record.
 */
export function resolveFirstPaidAt(
  existing: Date | null | undefined,
  stripeStatus: string,
  now: Date,
): Date | null | undefined {
  if (existing) return undefined;
  return stripeStatus === 'active' ? now : null;
}