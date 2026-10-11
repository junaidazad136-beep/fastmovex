import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export type UploadKind = 'image' | 'document' | 'video';

export const UPLOAD_LIMITS: Record<UploadKind, number> = {
  image: 5 * 1024 * 1024,
  document: 10 * 1024 * 1024,
  video: 30 * 1024 * 1024,
};

const ALLOWED: Record<UploadKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  document: ['image/jpeg', 'image/png', 'application/pdf'],
  video: ['video/mp4'],
};

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
};

/**
 * Detects type from the file's real bytes (magic numbers), NOT from the filename or the
 * Content-Type the client sent. SVG/HTML are never accepted (they can carry scripts).
 */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  return null;
}

export interface ValidatedFile {
  buffer: Buffer;
  mime: string;
  ext: string;
  size: number;
}

export function validateUpload(file: Express.Multer.File | undefined, kind: UploadKind): ValidatedFile {
  if (!file?.buffer?.length) throw new BadRequestException('File is required (field name "file")');
  if (file.size > UPLOAD_LIMITS[kind]) {
    throw new PayloadTooLargeException(`File too large. Max ${UPLOAD_LIMITS[kind] / 1024 / 1024} MB`);
  }
  const mime = sniffMime(file.buffer);
  if (!mime || !ALLOWED[kind].includes(mime)) {
    throw new BadRequestException(`Unsupported file. Allowed: ${ALLOWED[kind].map((m) => EXT[m]).join(', ')}`);
  }
  return { buffer: file.buffer, mime, ext: EXT[mime], size: file.size };
}
