import { BadRequestException } from '@nestjs/common';

/** API accepts money as a string of digits in MINOR units ("15000" = QAR 150.00). Never floats. */
export const MINOR_AMOUNT_REGEX = /^\d{1,13}$/;

export function toMinor(value: string, field = 'amount'): bigint {
  if (!MINOR_AMOUNT_REGEX.test(value)) throw new BadRequestException(`${field} must be a whole number of minor units`);
  return BigInt(value);
}
