/** Bundled example image (`public/sample.png`) for trying VectorSnap without a file. */
export const SAMPLE_IMAGE_URL = '/sample.png';

/** Download the sample image as a `File`, as if the user had chosen it. */
export async function loadSampleImage(signal?: AbortSignal): Promise<File> {
  const response = await fetch(SAMPLE_IMAGE_URL, { signal });
  if (!response.ok) throw new Error('Could not load the sample image.');
  const blob = await response.blob();
  return new File([blob], 'sample.png', { type: 'image/png' });
}
