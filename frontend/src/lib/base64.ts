/** Convert base64 data (as returned by the API) to a Blob. */
export function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function dataUrl(data: string, type: string): string {
  return `data:${type};base64,${data}`;
}
