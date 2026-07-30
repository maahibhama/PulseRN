import { open } from 'node:fs/promises';

const [filePath, expected] = process.argv.slice(2);
const machines = {
  x64: 0x8664,
  arm64: 0xaa64,
};

if (!filePath || !(expected in machines)) {
  throw new Error(
    'Usage: node scripts/verify-pe-architecture.mjs <executable> <x64|arm64>',
  );
}

const file = await open(filePath, 'r');
try {
  const dosHeader = Buffer.alloc(64);
  await file.read(dosHeader, 0, dosHeader.length, 0);
  if (dosHeader.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`${filePath} is not a PE executable.`);
  }

  const peOffset = dosHeader.readUInt32LE(0x3c);
  const peHeader = Buffer.alloc(6);
  await file.read(peHeader, 0, peHeader.length, peOffset);
  if (peHeader.toString('ascii', 0, 4) !== 'PE\u0000\u0000') {
    throw new Error(`${filePath} has an invalid PE header.`);
  }

  const actual = peHeader.readUInt16LE(4);
  if (actual !== machines[expected]) {
    throw new Error(
      `${filePath} has PE machine 0x${actual.toString(16)}, expected ${expected} (0x${machines[
        expected
      ].toString(16)}).`,
    );
  }

  console.log(`${filePath} is ${expected}.`);
} finally {
  await file.close();
}
