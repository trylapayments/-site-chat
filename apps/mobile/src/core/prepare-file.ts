// Reading metadata before an asynchronous copy finishes can enqueue a zero-byte upload.
export async function copyPreparedFile(copy: () => Promise<void>, size: () => number) {
  await copy();
  const bytes = size();
  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    throw new Error("Unable to prepare this file. Please select it again.");
  return bytes;
}
