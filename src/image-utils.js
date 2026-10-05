export const IMAGE_TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
export function validImageFile(file, maxSize) {
  return !!file && Object.hasOwn(IMAGE_TYPES, file.type) && file.size > 0 && file.size <= maxSize;
}
export function safeImageUrl(value) {
  if (typeof value !== 'string' || value.length > 1024) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
