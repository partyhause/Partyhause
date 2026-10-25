/**
 * Contract for the phrase-hint table behind generateFormData.
 *
 * This function was a 10-case switch with cyclomatic complexity 69, whose
 * ordering rules (intimate beats grand, 24-hour beats 48-hour, weekend and
 * N-day both mean a 2-day festival) existed only as else-if side effects.
 * Reframing it as data risked silently inverting one of those exclusivity
 * pairs, which is exactly the class of defect the old shape made invisible.
 * These tests pin every ordering rule and the field set per template, so a
 * table edit that changes which value wins fails loudly.
 */

import { describe, expect, it } from 'vitest';

import { generateFormData } from '../../server/lib/event-extraction';

describe('generateFormData', () => {
  it('seeds shared fields from the extraction before any phrase runs', () => {
    const r = generateFormData('wedding', 'nothing relevant', {
      guests: 42,
      budget: 500,
      theme: 'Vintage',
    });
    expect(r).toEqual({ expected_guest_count: 42, budget_estimate: 500, theme: 'Vintage' });
  });

  it('returns only the shared fields when no template matches', () => {
    const r = generateFormData('unknown-template', 'surprise open bar keynote', {
      guests: 10,
      budget: 100,
      theme: 'x',
    });
    expect(r).toEqual({ expected_guest_count: 10, budget_estimate: 100, theme: 'x' });
  });

  it('returns only the shared fields for empty text', () => {
    expect(generateFormData('wedding', '', {})).toEqual({});
  });

  it('detects birthday hints including multi-phrase rules', () => {
    const r = generateFormData('birthday', 'milestone surprise with open bar, dinner, bounce house', {});
    expect(r).toEqual({
      is_milestone: true,
      is_surprise: true,
      bar_service: 'Open Bar',
      meal_service: 'Dinner',
      activities: ['Bounce House'],
    });
  });

  it('matches any single phrase of an any-list (cocktails alone)', () => {
    expect(generateFormData('birthday', 'just cocktails', {})).toEqual({ bar_service: 'Open Bar' });
  });

  it('shares the birthday table with kids-birthday', () => {
    expect(generateFormData('kids-birthday', 'a milestone party with bounce house', {})).toEqual({
      is_milestone: true,
      activities: ['Bounce House'],
    });
  });

  it('parses the N-day capture group into number_of_days for conferences', () => {
    expect(generateFormData('conference', 'a 3-day conference', {})).toEqual({ number_of_days: 3 });
    expect(generateFormData('conference', 'a 5-day conference', {})).toEqual({ number_of_days: 5 });
    expect(generateFormData('conference', 'a 72-hour hackathon', {})).toEqual({});
  });

  it('lets festival weekend and N-day both resolve to 2 days', () => {
    expect(generateFormData('festival', 'a weekend festival', {})).toEqual({ duration_days: 2 });
    expect(generateFormData('festival', 'a 5-day festival', {})).toEqual({ duration_days: 2 });
    expect(generateFormData('festival', 'a 2-day festival', {})).toEqual({ duration_days: 2 });
  });

  it('lets intimate/small win over grand/large when both hit, matching the old else-if', () => {
    expect(generateFormData('wedding', 'intimate and grand wedding', {})).toEqual({
      wedding_size: 'Intimate',
    });
    // Both phrases hit here too ('small' is present), so the first-listed
    // rule wins regardless of which phrase appears first in the text.
    expect(generateFormData('wedding', 'grand wedding that feels small', {})).toEqual({
      wedding_size: 'Intimate',
    });
    expect(generateFormData('wedding', 'a small wedding', {})).toEqual({ wedding_size: 'Intimate' });
    expect(generateFormData('wedding', 'a grand wedding', {})).toEqual({ wedding_size: 'Grand' });
  });

  it('lets 24-hour win over 48-hour in a hackathon description', () => {
    expect(generateFormData('hackathon', 'a 24-hour hackathon', {})).toEqual({ duration_hours: 24 });
    expect(generateFormData('hackathon', 'a 48-hour hackathon', {})).toEqual({ duration_hours: 48 });
    expect(generateFormData('hackathon', 'a 24-hour and 48-hour hackathon', {})).toEqual({
      duration_hours: 24,
    });
    expect(generateFormData('hackathon', 'a 72-hour hackathon', {})).toEqual({});
  });

  it('doubles the extracted budget as the fundraising goal', () => {
    const r = generateFormData('fundraiser', 'a silent auction', { budget: 250 });
    expect(r).toEqual({ has_silent_auction: true, budget_estimate: 250, fundraising_goal: 250 });
    // Other templates do not get the alias.
    expect(generateFormData('birthday', 'surprise', { budget: 250 })).toEqual({
      budget_estimate: 250,
      is_surprise: true,
    });
  });

  it('does not let generic phrase fragments match inside words', () => {
    // 'food' must be word-bounded: 'foodie' alone is not a food vendor signal.
    expect(generateFormData('festival', 'a foodie paradise', {})).toEqual({});
    expect(generateFormData('festival', 'street food trucks', {})).toEqual({ food_vendors: true });
  });
});
