export function shortIdentifier(value: string, length = 12): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export async function copyText(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  await navigator.clipboard.writeText(value);
  return true;
}
