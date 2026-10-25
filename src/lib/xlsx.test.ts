import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toXlsx } from "./xlsx";

// Reads a zip's entries from the central directory: name → text.
function unzip(bytes: Uint8Array): Map<string, string> {
  const buf = Buffer.from(bytes);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("toXlsx", () => {
  const files = unzip(
    toXlsx([
      { name: "Roster", rows: [["Name", "Paid"], ["Ana & <Bo>", "Yes"], ["Total", 2]] },
      { name: "Sponsor pledges", rows: [["Sponsor", "Pledged (USD)"], ["Acme", 2500.5]] },
    ]),
  );

  it("writes one worksheet per sheet, named in the workbook", () => {
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ]),
    );
    const workbook = files.get("xl/workbook.xml")!;
    expect(workbook).toContain('<sheet name="Roster" sheetId="1" r:id="rId1"/>');
    expect(workbook).toContain('<sheet name="Sponsor pledges" sheetId="2" r:id="rId2"/>');
  });

  it("escapes text and keeps numbers numeric", () => {
    const roster = files.get("xl/worksheets/sheet1.xml")!;
    expect(roster).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Ana &amp; &lt;Bo&gt;</t></is></c>');
    expect(roster).toContain('<c r="B3"><v>2</v></c>');
    expect(files.get("xl/worksheets/sheet2.xml")).toContain('<c r="B2"><v>2500.5</v></c>');
  });

  it("cuts sheet names to Excel's 31 characters and drops forbidden characters", () => {
    const named = unzip(toXlsx([{ name: "A/very:long*name?[that]goes past the limit", rows: [] }]));
    expect(named.get("xl/workbook.xml")).toContain('<sheet name="A very long name  that goes pas" ');
  });
});
