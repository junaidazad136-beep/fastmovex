import { Injectable } from '@nestjs/common';
import { DeliveryQuote, DeliveryQuoteFn } from './pricing.types';

export interface CountryDeliveryConfig {
  flatFeeMinor?: string; // per seller shipment
  freeOverMinor?: string | null; // goods (after discount) at or above this ship free
  label?: string;
}

/**
 * Default quoter: country-level flat fee with a free-delivery threshold, configured by admin in Country.deliveryConfig.
 * The delivery phase replaces this with real providers (seller delivery zones, FastMoveX fleet, 3PL rates)
 * behind the same DeliveryQuoteFn signature, so pricing and checkout do not change.
 */
@Injectable()
export class ConfigDeliveryQuoter {
  forCountry(config: unknown): DeliveryQuoteFn {
    const c = parseConfig(config);
    return (_sellerId: string, goodsNet: bigint): DeliveryQuote => {
      const free = c.freeOver !== null && goodsNet >= c.freeOver;
      return { feeMinor: free ? 0n : c.flatFee, method: 'STANDARD', label: free ? 'Free delivery' : c.label };
    };
  }
}

export function parseConfig(raw: unknown): { flatFee: bigint; freeOver: bigint | null; label: string } {
  const c = (raw && typeof raw === 'object' ? raw : {}) as CountryDeliveryConfig;
  const big = (v: unknown) => (typeof v === 'string' && /^\d{1,13}$/.test(v) ? BigInt(v) : null);
  return { flatFee: big(c.flatFeeMinor) ?? 0n, freeOver: big(c.freeOverMinor), label: typeof c.label === 'string' ? c.label : 'Standard delivery' };
}
