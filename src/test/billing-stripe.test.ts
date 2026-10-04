import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCheckoutSessionRequest } from '../../packages/core/src/contracts/billing';

const CREATOR_PRICE = 'price_creator_test_123';
const VENDOR_PRICE = 'price_vendor_test_456';

/** Re-import the lib with controlled price env, since the contract reads them at module load. */
async function loadStripeLib(priceCreator?: string, priceVendor?: string) {
  vi.resetModules();
  if (priceCreator === undefined) delete process.env.STRIPE_PRICE_CREATOR;
  else process.env.STRIPE_PRICE_CREATOR = priceCreator;
  if (priceVendor === undefined) delete process.env.STRIPE_PRICE_VENDOR;
  else process.env.STRIPE_PRICE_VENDOR = priceVendor;
  return import('../../server/lib/stripe');
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.STRIPE_PRICE_CREATOR;
  delete process.env.STRIPE_PRICE_VENDOR;
  delete process.env.STRIPE_SECRET_KEY;
});

describe('mapStripeStatusToLocal', () => {
  it.each([
    ['active', 'active'],
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['canceled', 'canceled'],
    ['incomplete', 'expired'],
    ['incomplete_expired', 'expired'],
    ['unpaid', 'past_due'],
    ['paused', 'canceled'],
  ] as const)('%s maps to %s', async (stripeStatus, expected) => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    expect(lib.mapStripeStatusToLocal(stripeStatus)).toBe(expected);
  });

  it('defaults unknown statuses to expired rather than throwing', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    expect(lib.mapStripeStatusToLocal('some_future_status' as never)).toBe('expired');
  });
});

describe('mapStripePriceToPlan', () => {
  it('resolves both configured price ids', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    expect(lib.mapStripePriceToPlan(CREATOR_PRICE)).toBe('creator');
    expect(lib.mapStripePriceToPlan(VENDOR_PRICE)).toBe('vendor');
  });

  it('returns null for unknown, missing, and empty price ids', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    expect(lib.mapStripePriceToPlan('price_nobody')).toBeNull();
    expect(lib.mapStripePriceToPlan(undefined)).toBeNull();
    expect(lib.mapStripePriceToPlan('')).toBeNull();
  });

  it('returns null when no prices are configured instead of matching empty strings', async () => {
    const lib = await loadStripeLib(undefined, undefined);
    expect(lib.mapStripePriceToPlan('')).toBeNull();
    expect(lib.mapStripePriceToPlan('price_creator_test_123')).toBeNull();
  });
});

describe('getPriceId', () => {
  it('returns the configured price id', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    expect(lib.getPriceId('creator')).toBe(CREATOR_PRICE);
    expect(lib.getPriceId('vendor')).toBe(VENDOR_PRICE);
  });

  it('throws when the price id is not configured', async () => {
    const lib = await loadStripeLib(undefined, undefined);
    expect(() => lib.getPriceId('creator')).toThrow(/not configured/);
  });
});

describe('getStripe', () => {
  it('throws without a secret key instead of constructing a broken client', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => lib.getStripe()).toThrow(/STRIPE_SECRET_KEY/);
  });
});

describe('resolveFirstPaidAt', () => {
  it('leaves a stored timestamp untouched', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    const stored = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date('2026-09-29T00:00:00.000Z');
    expect(lib.resolveFirstPaidAt(stored, 'active', now)).toBeUndefined();
  });

  it('records now on the first paid conversion and null otherwise', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    const now = new Date('2026-09-29T00:00:00.000Z');
    expect(lib.resolveFirstPaidAt(null, 'active', now)).toBe(now);
    expect(lib.resolveFirstPaidAt(null, 'trialing', now)).toBeNull();
    expect(lib.resolveFirstPaidAt(undefined, 'past_due', now)).toBeNull();
  });
});

describe('invoiceSubscriptionId', () => {
  it('reads the subscription id from the invoice parent', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    expect(
      lib.invoiceSubscriptionId({
        parent: {
          type: 'subscription_details',
          quote_details: null,
          subscription_details: { subscription: 'sub_123', metadata: null },
        },
      } as never),
    ).toBe('sub_123');
  });

  it('handles expanded subscriptions and non-subscription invoices', async () => {
    const lib = await loadStripeLib(CREATOR_PRICE, VENDOR_PRICE);
    expect(
      lib.invoiceSubscriptionId({
        parent: {
          type: 'subscription_details',
          quote_details: null,
          subscription_details: { subscription: { id: 'sub_456' }, metadata: null },
        },
      } as never),
    ).toBe('sub_456');
    expect(lib.invoiceSubscriptionId({ parent: null } as never)).toBeNull();
    expect(
      lib.invoiceSubscriptionId({
        parent: { type: 'quote_details', quote_details: { quote: 'qt_1' }, subscription_details: null },
      } as never),
    ).toBeNull();
  });
});

describe('createCheckoutSessionRequest', () => {
  it('accepts a plan-only request', () => {
    expect(createCheckoutSessionRequest.safeParse({ plan: 'creator' }).success).toBe(true);
  });

  it('rejects unknown plans and malformed urls', () => {
    expect(createCheckoutSessionRequest.safeParse({ plan: 'pro' }).success).toBe(false);
    expect(
      createCheckoutSessionRequest.safeParse({ plan: 'creator', success_url: 'not-a-url' }).success,
    ).toBe(false);
  });
});
