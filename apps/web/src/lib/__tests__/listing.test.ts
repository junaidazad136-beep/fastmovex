import { describe, expect, it } from 'vitest';
import { hasFilters, parseListing, toApiParams, toUrlParams } from '../listing';

describe('listing query', () => {
  it('drops anything invalid instead of forwarding it to the API', () => {
    const q = parseListing({ q: '  phone ', category: 'Bad Slug!', brands: 'nova,UP PER,apple', min: 'abc', max: '200', rating: '9', sort: 'drop table', page: '-3', inStock: '1' });
    expect(q).toMatchObject({ q: 'phone', category: undefined, brands: ['nova', 'apple'], min: undefined, max: '200', rating: undefined, sort: 'relevance', page: 1, inStock: true });
  });

  it('defaults to popular when there is no search text', () => {
    expect(parseListing({}).sort).toBe('popular');
  });

  it('turns shopper prices into minor units and never sends an impossible range', () => {
    const q = parseListing({ min: '300', max: '100', brands: 'nova' });
    expect(toApiParams(q, 2)).toMatchObject({ minPrice: '30000', maxPrice: undefined, brands: 'nova', limit: 24 });
    expect(toApiParams(parseListing({ min: '10.5' }), 3).minPrice).toBe('10500');
  });

  it('keeps URLs short: defaults and page-fixed keys are omitted', () => {
    const q = parseListing({ category: 'electronics', sort: 'popular', page: '1', brands: 'nova' });
    expect(toUrlParams(q, ['category'])).toEqual({ brands: 'nova' });
    expect(toUrlParams({ ...q, page: 2, sort: 'newest' }, ['category'])).toEqual({ brands: 'nova', sort: 'newest', page: '2' });
    expect(hasFilters(q)).toBe(true);
    expect(hasFilters(parseListing({ q: 'x' }))).toBe(false);
  });
});
