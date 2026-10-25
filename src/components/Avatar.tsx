/** Centre-crop to a square and resize to 256 px JPEG — small enough for any use. */
export async function prepareAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas
    .getContext('2d')
    ?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))), 'image/jpeg', 0.85),
  );
}

export function Avatar({ url, username, size = 72 }: { url: string | null; username: string; size?: number }) {
  return url ? (
    <img className="profile-avatar" src={url} alt="" width={size} height={size} />
  ) : (
    <span className="profile-avatar placeholder" style={{ width: size, height: size }}>
      {username.slice(0, 1).toUpperCase()}
    </span>
  );
}
