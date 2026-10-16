import assert from 'node:assert/strict';
import { crc32, deflateSync, inflateRawSync } from 'node:zlib';
import {
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
// Synthetic images only: no signatures, identities, or real legal evidence.
function png(stamp) {
  const size = 96;
  const pixels = Buffer.alloc((size * 3 + 1) * size, 255);
  for (let y = 0; y < size; y++) {
    pixels[y * (size * 3 + 1)] = 0; // PNG scanline filter.
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x - 48, y - 48);
      const ink = stamp
        ? (radius > 35 && radius < 40) || (x > 25 && x < 71 && y > 43 && y < 51)
        : x > 12 && x < 83 && y > 15 && y < 80 && (x % 20 < 5 || y % 20 < 5);
      if (ink) {
        const offset = y * (size * 3 + 1) + 1 + x * 3;
        pixels.set(stamp ? [30, 70, 160] : [80, 100, 80], offset);
      }
    }
  }
  function chunk(type, data) {
    const name = Buffer.from(type),
      length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2; // 8-bit RGB.
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Inventory only OUR small generated ZIP. This is not an upload parser or a
// production image detector. It deliberately rejects ZIP64 and large entries.
function fixtureParts(bytes) {
  const end = bytes.lastIndexOf(Buffer.from('504b0506', 'hex'));
  assert(end >= 0);
  const count = bytes.readUInt16LE(end + 10);
  assert(count < 100);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const method = bytes.readUInt16LE(offset + 10);
    const packed = bytes.readUInt32LE(offset + 20),
      unpacked = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    assert(packed < 1_000_000 && unpacked < 1_000_000);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + packed);
    assert(method === 0 || method === 8);
    const content = method === 8 ? inflateRawSync(data, { maxOutputLength: 1_000_000 }) : data;
    assert.equal(content.length, unpacked);
    assert.equal(crc32(content), bytes.readUInt32LE(offset + 16));
    entries.set(bytes.subarray(offset + 46, offset + 46 + nameSize).toString(), content);
    offset += 46 + nameSize + extra + comment;
  }
  return entries;
}
export async function wordVisualFixture() {
  const graphic = png(false),
    stamp = png(true);
  const text = (value) =>
    new Paragraph({
      bidirectional: true,
      children: [new TextRun({ text: value, rightToLeft: true })],
    });
  const image = (data) =>
    new Paragraph({
      bidirectional: true,
      children: [new ImageRun({ type: 'png', data, transformation: { width: 96, height: 96 } })],
    });
  const bytes = Buffer.from(
    await Packer.toBuffer(
      new Document({
        sections: [
          {
            headers: {
              default: new Header({ children: [text('رأس اختبار عربي اصطناعي'), image(graphic)] }),
            },
            footers: {
              default: new Footer({ children: [image(stamp), text('ختم تجريبي لا حجية له')] }),
            },
            children: [
              text('مستند عربي اصطناعي لا يمثل قضية حقيقية'),
              image(graphic),
              new Table({
                visuallyRightToLeft: true,
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({ children: [text('البند')] }),
                      new TableCell({ children: [text('القيمة')] }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({ children: [text('مبلغ تجريبي')] }),
                      new TableCell({ children: [text('١٠٠٠ ريال')] }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({ children: [text('صورة ختم اصطناعي')] }),
                      new TableCell({ children: [image(stamp)] }),
                    ],
                  }),
                ],
              }),
            ],
          },
        ],
      }),
    ),
  );
  const parts = fixtureParts(bytes);
  const document = parts.get('word/document.xml').toString();
  assert(document.includes('مستند عربي اصطناعي'));
  assert(document.includes('١٠٠٠ ريال'));
  assert(
    document.includes('<w:tbl>') &&
      document.includes('<w:bidi') &&
      document.includes('<w:bidiVisual'),
  );
  assert(document.includes('<w:drawing>'));
  for (const name of ['word/header1.xml', 'word/footer1.xml']) {
    assert(parts.get(name).toString().includes('<w:drawing>'), `${name} contains an image`);
  }
  const media = [...parts]
    .filter(([name]) => name.startsWith('word/media/'))
    .map(([, data]) => data);
  assert(media.some((data) => data.equals(graphic)));
  assert(media.some((data) => data.equals(stamp)));
  for (const name of [
    'word/_rels/document.xml.rels',
    'word/_rels/header1.xml.rels',
    'word/_rels/footer1.xml.rels',
  ]) {
    assert(parts.get(name).toString().includes('/image'), `${name} references embedded media`);
  }
  return { bytes, parts };
}
