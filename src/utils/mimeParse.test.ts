import { describe, it, expect } from "vitest";
import { parseMimeAttachments, extractMimeAttachment } from "./mimeParse.js";

const MIME_WITH_PDF = `Content-Type: multipart/mixed;
\tboundary="_004_TEST"
MIME-Version: 1.0

--_004_TEST
Content-Type: text/plain; charset="us-ascii"
Content-Transfer-Encoding: quoted-printable

Hello world

--_004_TEST
Content-Type: application/pdf; name="report.pdf"
Content-Description: report.pdf
Content-Disposition: attachment;
\tfilename="report.pdf"; size=100;
\tcreation-date="Mon, 14 Apr 2026 12:10:46 GMT";
\tmodification-date="Mon, 14 Apr 2026 12:10:46 GMT"
Content-Transfer-Encoding: base64

JVBERi0xLjAKMSAwIG9iago=

--_004_TEST--`;

const MIME_TEXT_ONLY = `Content-Type: text/plain; charset="us-ascii"
MIME-Version: 1.0

Just a plain text email with no attachments.`;

const MIME_MULTI_ATTACH = `Content-Type: multipart/mixed;
\tboundary="_004_MULTI"

--_004_MULTI
Content-Type: text/plain; charset="us-ascii"

Body text

--_004_MULTI
Content-Type: application/pdf; name="doc1.pdf"
Content-Disposition: attachment; filename="doc1.pdf"; size=50
Content-Transfer-Encoding: base64

AAAA

--_004_MULTI
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="doc2.docx"
Content-Disposition: attachment; filename="doc2.docx"; size=75
Content-Transfer-Encoding: base64

BBBB

--_004_MULTI--`;

const MIME_WITH_INLINE = `Content-Type: multipart/mixed;
\tboundary="_004_INLINE"

--_004_INLINE
Content-Type: text/html; charset="us-ascii"

<html><body>Hi</body></html>

--_004_INLINE
Content-Type: image/png; name="image001.png"
Content-Disposition: inline; filename="image001.png"
Content-Transfer-Encoding: base64

iVBORw0KGgo=

--_004_INLINE
Content-Type: application/pdf; name="actual-doc.pdf"
Content-Disposition: attachment; filename="actual-doc.pdf"; size=200
Content-Transfer-Encoding: base64

JVBERi0xLjAK

--_004_INLINE--`;

describe("parseMimeAttachments", () => {
  it("extracts attachment metadata from MIME source", () => {
    const result = parseMimeAttachments(MIME_WITH_PDF);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("report.pdf");
    expect(result[0].mimeType).toBe("application/pdf");
    expect(result[0].size).toBe(100);
  });

  it("returns empty array for text-only messages", () => {
    const result = parseMimeAttachments(MIME_TEXT_ONLY);
    expect(result).toHaveLength(0);
  });

  it("extracts multiple attachments", () => {
    const result = parseMimeAttachments(MIME_MULTI_ATTACH);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("doc1.pdf");
    expect(result[1].name).toBe("doc2.docx");
  });

  it("skips inline dispositions", () => {
    const result = parseMimeAttachments(MIME_WITH_INLINE);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("actual-doc.pdf");
  });

  it("returns empty array for empty input", () => {
    expect(parseMimeAttachments("")).toHaveLength(0);
    expect(parseMimeAttachments("   ")).toHaveLength(0);
  });

  it("estimates size from base64 when size header missing", () => {
    const noSizeMime = `Content-Type: multipart/mixed;
\tboundary="_004_NOSIZE"

--_004_NOSIZE
Content-Type: application/pdf; name="test.pdf"
Content-Disposition: attachment; filename="test.pdf"
Content-Transfer-Encoding: base64

AAAAAAAAAAAAAAAA

--_004_NOSIZE--`;
    const result = parseMimeAttachments(noSizeMime);
    expect(result).toHaveLength(1);
    expect(result[0].size).toBeGreaterThan(0);
  });
});

describe("extractMimeAttachment", () => {
  it("decodes base64 content for a named attachment", () => {
    const result = extractMimeAttachment(MIME_WITH_PDF, "report.pdf");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("report.pdf");
    expect(result!.data).toBeInstanceOf(Buffer);
    expect(result!.data.length).toBeGreaterThan(0);
  });

  it("returns null for non-existent attachment", () => {
    const result = extractMimeAttachment(MIME_WITH_PDF, "nope.pdf");
    expect(result).toBeNull();
  });

  it("extracts the correct attachment from multiple", () => {
    const result = extractMimeAttachment(MIME_MULTI_ATTACH, "doc2.docx");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("doc2.docx");
  });

  it("returns null for empty input", () => {
    expect(extractMimeAttachment("", "test.pdf")).toBeNull();
    expect(extractMimeAttachment("   ", "test.pdf")).toBeNull();
  });
});
