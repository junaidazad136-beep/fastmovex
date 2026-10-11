import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export interface CleanPhoto { buffer: Buffer; mime: 'image/webp'; ext: 'webp'; width: number; height: number }

/**
 * Customer photos before they become public: turned upright, shrunk to at most `maxSide` pixels and re-encoded as WebP.
 * Re-encoding drops every bit of metadata — above all the GPS position phones store in photos (a customer's home).
 * Decompression bombs are refused (40 megapixels max).
 */
export async function cleanPhoto(input: Buffer, maxSide = 1600): Promise<CleanPhoto> {
  try {
    const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, mime: 'image/webp', ext: 'webp', width: info.width, height: info.height };
  } catch {
    throw new BadRequestException('This photo could not be read. Please try another one (JPG, PNG or WebP).');
  }
}
