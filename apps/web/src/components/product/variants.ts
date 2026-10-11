import type { Variant } from '@/lib/api/types';

/** Option names in first-seen order, e.g. ["Colour", "Size"]. */
export function optionNames(variants: Variant[]): string[] {
  const names: string[] = [];
  for (const v of variants) for (const k of Object.keys(v.optionValues ?? {})) if (!names.includes(k)) names.push(k);
  return names;
}

export function optionValues(variants: Variant[], name: string): string[] {
  const vals: string[] = [];
  for (const v of variants) {
    const x = v.optionValues?.[name];
    if (x !== undefined && !vals.includes(x)) vals.push(x);
  }
  return vals;
}

export function findVariant(variants: Variant[], selected: Record<string, string>): Variant | undefined {
  return variants.find((v) => Object.entries(selected).every(([k, val]) => v.optionValues?.[k] === val));
}

/** Can `name=value` still lead to an in-stock variant, given the other choices? */
export function isValueAvailable(variants: Variant[], selected: Record<string, string>, name: string, value: string): boolean {
  const wanted = { ...selected, [name]: value };
  return variants.some((v) => v.inStock && Object.entries(wanted).every(([k, val]) => v.optionValues?.[k] === val));
}

/** Picking a value that does not combine with the other choices switches to the closest variant that has it. */
export function selectValue(variants: Variant[], selected: Record<string, string>, name: string, value: string): Record<string, string> {
  const exact = findVariant(variants, { ...selected, [name]: value });
  if (exact) return { ...exact.optionValues };
  const withValue = variants.filter((v) => v.optionValues?.[name] === value);
  const best = withValue.find((v) => v.inStock) ?? withValue[0];
  return best ? { ...best.optionValues } : { ...selected, [name]: value };
}

export function defaultVariant(variants: Variant[]): Variant | undefined {
  return variants.find((v) => v.inStock) ?? variants[0];
}
