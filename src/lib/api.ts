/**
 * Backend abstraction for user-generated content.
 *
 * The app ships as a static GitHub Pages site, so it has no server by default.
 * This module lets ratings, reviews and photos work immediately in the browser
 * (stored locally) and sync to a backend as soon as one is configured.
 *
 * Wire up a backend by setting VITE_API_URL in .env.local. Until then,
 * contributions are kept on the user's device and marked "pending".
 */

export interface Review {
  id: string;
  venueSlug: string;
  rating: number;
  comment: string;
  author: string;
  createdAt: string;
  syncedAt?: string;
}

export interface Photo {
  id: string;
  venueSlug: string;
  dataUrl: string;
  credit: string;
  licence: string;
  author: string;
  createdAt: string;
  syncedAt?: string;
}

interface ApiConfig {
  url: string | null;
  key: string | null;
}

const REVIEWS_KEY = 'hillgpx:localReviews';
const PHOTOS_KEY = 'hillgpx:localPhotos';
const AUTHOR_KEY = 'hillgpx:authorName';

function loadConfig(): ApiConfig {
  return {
    url: (import.meta.env.VITE_API_URL as string | undefined) || null,
    key: (import.meta.env.VITE_API_KEY as string | undefined) || null,
  };
}

export function backendConfigured(): boolean {
  return Boolean(loadConfig().url);
}

export function loadAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAuthor(author: string): void {
  try {
    localStorage.setItem(AUTHOR_KEY, author);
  } catch {
    // ignore
  }
}

export function loadLocalReviews(): Review[] {
  try {
    const raw = localStorage.getItem(REVIEWS_KEY);
    return raw ? (JSON.parse(raw) as Review[]) : [];
  } catch {
    return [];
  }
}

export function loadLocalPhotos(): Photo[] {
  try {
    const raw = localStorage.getItem(PHOTOS_KEY);
    return raw ? (JSON.parse(raw) as Photo[]) : [];
  } catch {
    return [];
  }
}

function setReviews(reviews: Review[]): void {
  localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
}

function setPhotos(photos: Photo[]): void {
  localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos));
}

export function reviewsForVenue(slug: string): Review[] {
  return loadLocalReviews()
    .filter((review) => review.venueSlug === slug)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function photosForVenue(slug: string): Photo[] {
  return loadLocalPhotos()
    .filter((photo) => photo.venueSlug === slug)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function pendingCount(): number {
  return loadLocalReviews().filter((r) => !r.syncedAt).length + loadLocalPhotos().filter((p) => !p.syncedAt).length;
}

export interface SubmitReviewInput {
  venueSlug: string;
  rating: number;
  comment: string;
  author: string;
}

export interface SubmitPhotoInput {
  venueSlug: string;
  file: File;
  credit: string;
  licence: string;
  author: string;
}

export interface SubmitResult<T> {
  status: 'synced' | 'local';
  item: T;
  error?: string;
}

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function submitReview(input: SubmitReviewInput): Promise<SubmitResult<Review>> {
  const review: Review = {
    id: uuid(),
    venueSlug: input.venueSlug,
    rating: input.rating,
    comment: input.comment.trim(),
    author: input.author.trim() || 'Anonymous',
    createdAt: new Date().toISOString(),
  };

  const config = loadConfig();
  if (config.url) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.key) headers['Authorization'] = `Bearer ${config.key}`;
      const response = await fetch(`${config.url}/reviews`, {
        method: 'POST',
        headers,
        body: JSON.stringify(review),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const synced = { ...review, syncedAt: new Date().toISOString() };
      setReviews([synced, ...loadLocalReviews()]);
      return { status: 'synced', item: synced };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setReviews([review, ...loadLocalReviews()]);
      return { status: 'local', item: review, error: message };
    }
  }

  setReviews([review, ...loadLocalReviews()]);
  return { status: 'local', item: review };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function submitPhoto(input: SubmitPhotoInput): Promise<SubmitResult<Photo>> {
  const dataUrl = await readFileAsDataUrl(input.file);
  if (dataUrl.length > 900_000) {
    throw new Error('Photo is too large to store locally. Try a smaller image or configure a backend.');
  }
  const photo: Photo = {
    id: uuid(),
    venueSlug: input.venueSlug,
    dataUrl,
    credit: input.credit.trim(),
    licence: input.licence.trim(),
    author: input.author.trim() || 'Anonymous',
    createdAt: new Date().toISOString(),
  };

  const config = loadConfig();
  if (config.url) {
    try {
      const form = new FormData();
      form.append('venueSlug', photo.venueSlug);
      form.append('credit', photo.credit);
      form.append('licence', photo.licence);
      form.append('author', photo.author);
      form.append('photo', input.file);
      const headers: Record<string, string> = {};
      if (config.key) headers['Authorization'] = `Bearer ${config.key}`;
      const response = await fetch(`${config.url}/photos`, { method: 'POST', headers, body: form });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const synced = { ...photo, syncedAt: new Date().toISOString() };
      setPhotos([synced, ...loadLocalPhotos()]);
      return { status: 'synced', item: synced };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPhotos([photo, ...loadLocalPhotos()]);
      return { status: 'local', item: photo, error: message };
    }
  }

  setPhotos([photo, ...loadLocalPhotos()]);
  return { status: 'local', item: photo };
}

/**
 * Try to push every locally-stored item that has not synced yet. Safe to call
 * repeatedly; already-synced items are skipped.
 */
export async function syncPending(): Promise<{ reviews: number; photos: number; errors: string[] }> {
  const config = loadConfig();
  if (!config.url) return { reviews: 0, photos: 0, errors: [] };

  const reviews = loadLocalReviews();
  const photos = loadLocalPhotos();
  let reviewCount = 0;
  let photoCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < reviews.length; i++) {
    if (reviews[i].syncedAt) continue;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.key) headers['Authorization'] = `Bearer ${config.key}`;
      const response = await fetch(`${config.url}/reviews`, {
        method: 'POST',
        headers,
        body: JSON.stringify(reviews[i]),
      });
      if (!response.ok) throw new Error(`review ${reviews[i].id}: HTTP ${response.status}`);
      reviews[i] = { ...reviews[i], syncedAt: new Date().toISOString() };
      reviewCount += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (let i = 0; i < photos.length; i++) {
    if (photos[i].syncedAt) continue;
    try {
      const file = await fetch(photos[i].dataUrl).then((r) => r.blob());
      const form = new FormData();
      form.append('venueSlug', photos[i].venueSlug);
      form.append('credit', photos[i].credit);
      form.append('licence', photos[i].licence);
      form.append('author', photos[i].author);
      form.append('photo', file);
      const headers: Record<string, string> = {};
      if (config.key) headers['Authorization'] = `Bearer ${config.key}`;
      const response = await fetch(`${config.url}/photos`, { method: 'POST', headers, body: form });
      if (!response.ok) throw new Error(`photo ${photos[i].id}: HTTP ${response.status}`);
      photos[i] = { ...photos[i], syncedAt: new Date().toISOString() };
      photoCount += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  setReviews(reviews);
  setPhotos(photos);
  return { reviews: reviewCount, photos: photoCount, errors };
}

/**
 * Combined rating for a venue: published data from build_data.py plus the
 * user's local reviews. Once a backend is in place this can be replaced by
 * a server fetch.
 */
export function combinedRating(venueSlug: string, published?: { average: number; count: number }): { average: number; count: number } | undefined {
  const local = reviewsForVenue(venueSlug).filter((review) => review.rating > 0);
  const publishedCount = published && published.count > 0 ? published.count : 0;
  if (publishedCount === 0 && local.length === 0) return undefined;
  const all = [
    ...(publishedCount > 0 ? Array(publishedCount).fill(published!.average) : []),
    ...local.map((review) => review.rating),
  ];
  const sum = all.reduce((a, b) => a + b, 0);
  return { average: Math.round((sum / all.length) * 100) / 100, count: all.length };
}
