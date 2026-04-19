/**
 * MIME Source Parser for Attachment Extraction
 *
 * Parses raw email MIME source to extract attachment metadata and content.
 * Used as a fallback when AppleScript's `mail attachments` returns empty
 * (which happens across all account types: iCloud, Google, Exchange).
 *
 * @module utils/mimeParse
 */

export interface MimeAttachmentInfo {
  /** Filename from Content-Disposition or Content-Type name parameter */
  name: string;
  /** MIME type from Content-Type header */
  mimeType: string;
  /** Size in bytes from Content-Disposition size parameter, or estimated from base64 */
  size: number;
}

export interface MimeAttachmentData extends MimeAttachmentInfo {
  /** Decoded binary content */
  data: Buffer;
}

/**
 * Extract the boundary string from a Content-Type header.
 */
function extractBoundary(source: string): string | null {
  const match = source.match(/boundary="?([^";\s\r\n]+)"?/i);
  return match ? match[1] : null;
}

/**
 * Extract a header value from a MIME part header block.
 * Handles folded headers (continuation lines starting with whitespace).
 */
function getHeader(headers: string, name: string): string | null {
  const regex = new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t]+.+)*)`, "im");
  const match = headers.match(regex);
  if (!match) return null;
  // Unfold: replace newline+whitespace with single space
  return match[1].replace(/\r?\n[ \t]+/g, " ").trim();
}

/**
 * Extract filename from Content-Disposition or Content-Type headers.
 */
function extractFilename(headers: string): string | null {
  // Try Content-Disposition filename first
  const dispHeader = getHeader(headers, "Content-Disposition");
  if (dispHeader) {
    const fnMatch = dispHeader.match(/filename="?([^";\r\n]+)"?/i);
    if (fnMatch) return fnMatch[1].trim();
  }
  // Fall back to Content-Type name parameter
  const ctHeader = getHeader(headers, "Content-Type");
  if (ctHeader) {
    const nameMatch = ctHeader.match(/name="?([^";\r\n]+)"?/i);
    if (nameMatch) return nameMatch[1].trim();
  }
  return null;
}

/**
 * Check if a MIME part has inline disposition (not a real attachment).
 */
function isInlineDisposition(headers: string): boolean {
  const dispHeader = getHeader(headers, "Content-Disposition");
  if (!dispHeader) return false;
  return dispHeader.toLowerCase().startsWith("inline");
}

/**
 * Extract size from Content-Disposition size parameter.
 */
function extractSize(headers: string): number {
  const dispHeader = getHeader(headers, "Content-Disposition");
  if (dispHeader) {
    const sizeMatch = dispHeader.match(/size=(\d+)/i);
    if (sizeMatch) return parseInt(sizeMatch[1], 10);
  }
  return 0;
}

/**
 * Extract MIME type from Content-Type header.
 */
function extractMimeType(headers: string): string {
  const ctHeader = getHeader(headers, "Content-Type");
  if (!ctHeader) return "application/octet-stream";
  const typeMatch = ctHeader.match(/^([^;\s]+)/);
  return typeMatch ? typeMatch[1].toLowerCase() : "application/octet-stream";
}

/**
 * Estimate decoded size from base64 content length.
 */
function estimateBase64Size(base64Body: string): number {
  const cleaned = base64Body.replace(/[\s\r\n]/g, "");
  return Math.floor((cleaned.length * 3) / 4);
}

/**
 * Split MIME source into parts using the boundary.
 */
function splitMimeParts(
  source: string,
  boundary: string
): Array<{ headers: string; body: string }> {
  const parts: Array<{ headers: string; body: string }> = [];
  const boundaryDelim = `--${boundary}`;

  const sections = source.split(boundaryDelim);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;

    // Split headers from body at first blank line
    const blankLineIdx = trimmed.search(/\r?\n\r?\n/);
    if (blankLineIdx === -1) continue;

    const headers = trimmed.substring(0, blankLineIdx);
    const body = trimmed.substring(blankLineIdx).replace(/^\r?\n\r?\n/, "");

    parts.push({ headers, body });
  }

  return parts;
}

/**
 * Parse MIME source and return metadata for all file attachments.
 * Skips inline dispositions (signature images, etc.).
 *
 * @param source - Raw MIME source of the email
 * @returns Array of attachment metadata (name, mimeType, size)
 */
export function parseMimeAttachments(source: string): MimeAttachmentInfo[] {
  if (!source || !source.trim()) return [];

  const boundary = extractBoundary(source);
  if (!boundary) return [];

  const parts = splitMimeParts(source, boundary);
  const attachments: MimeAttachmentInfo[] = [];

  for (const part of parts) {
    const filename = extractFilename(part.headers);
    if (!filename) continue;

    if (isInlineDisposition(part.headers)) continue;

    const encoding = getHeader(part.headers, "Content-Transfer-Encoding");
    if (!encoding || encoding.toLowerCase() !== "base64") continue;

    attachments.push({
      name: filename,
      mimeType: extractMimeType(part.headers),
      size: extractSize(part.headers) || estimateBase64Size(part.body),
    });
  }

  return attachments;
}

/**
 * Extract and decode a specific attachment from MIME source by filename.
 *
 * @param source - Raw MIME source of the email
 * @param attachmentName - Filename to extract
 * @returns Decoded attachment data, or null if not found
 */
export function extractMimeAttachment(
  source: string,
  attachmentName: string
): MimeAttachmentData | null {
  if (!source || !source.trim()) return null;

  const boundary = extractBoundary(source);
  if (!boundary) return null;

  const parts = splitMimeParts(source, boundary);

  for (const part of parts) {
    const filename = extractFilename(part.headers);
    if (filename !== attachmentName) continue;

    const encoding = getHeader(part.headers, "Content-Transfer-Encoding");
    if (!encoding || encoding.toLowerCase() !== "base64") continue;

    const base64Clean = part.body.replace(/[\s\r\n]/g, "");
    const data = Buffer.from(base64Clean, "base64");

    return {
      name: filename,
      mimeType: extractMimeType(part.headers),
      size: extractSize(part.headers) || data.length,
      data,
    };
  }

  return null;
}
