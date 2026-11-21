// Image upload and optimization utilities for PartyHause.
//
// Uploads POST to the Express API (`/api/storage/*`), which writes to Azure
// Blob Storage server-side. The browser never holds a storage credential.
// Compression and resizing run client-side first, so the request carries a
// reasonably-sized file rather than an original off a phone camera.
//
// The bearer token is the self-hosted HS256 JWT, attached via the shared
// `getAuthToken` helper so the API's `requireAuth` middleware accepts the
// request.

import { apiGet, apiPost, apiDelete } from './api-client';

export interface ImageUploadOptions {
  bucket: string;
  folder?: string;
  maxSizeBytes?: number;
  allowedTypes?: string[];
  quality?: number;
}

export interface ImageUploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

const DEFAULT_OPTIONS: Required<ImageUploadOptions> = {
  bucket: 'event-invites',
  folder: '',
  maxSizeBytes: 5 * 1024 * 1024, // 5MB
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  quality: 0.9,
};

/**
 * Validates an image file before upload
 */
export const validateImageFile = (
  file: File,
  options: Partial<ImageUploadOptions> = {}
): { valid: boolean; error?: string } => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check file type
  if (!opts.allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${opts.allowedTypes.join(', ')}`
    };
  }

  // Check file size
  if (file.size > opts.maxSizeBytes) {
    const maxSizeMB = opts.maxSizeBytes / (1024 * 1024);
    return {
      valid: false,
      error: `File too large. Maximum size: ${maxSizeMB}MB`
    };
  }

  return { valid: true };
};

/**
 * Compresses an image file if needed
 */
export const compressImage = async (
  file: File,
  quality: number = 0.9
): Promise<File> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      // Calculate new dimensions (max 1920x1080 for email compatibility)
      const maxWidth = 1920;
      const maxHeight = 1080;
      let { width, height } = img;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width *= ratio;
        height *= ratio;
      }

      canvas.width = width;
      canvas.height = height;

      // Draw and compress
      ctx?.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now()
            });
            resolve(compressedFile);
          } else {
            resolve(file); // Return original if compression fails
          }
        },
        file.type,
        quality
      );
    };

    img.onerror = () => resolve(file); // Return original if processing fails
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Uploads an image to Azure Blob Storage (via the API) with optimization.
 *
 * The `bucket` option is kept for backwards-compatibility but is ignored —
 * the API always uploads to the `event-invites` container. `folder` and
 * `fileName` are forwarded to the API to namespace the blob.
 */
export const uploadImage = async (
  file: File,
  fileName: string,
  options: Partial<ImageUploadOptions> = {}
): Promise<ImageUploadResult> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Validate file
    const validation = validateImageFile(file, opts);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Compress image if it's large
    let processedFile = file;
    if (file.size > 1024 * 1024) { // 1MB threshold
      processedFile = await compressImage(file, opts.quality);
    }

    // Build multipart form data for the API
    const formData = new FormData();
    formData.append('file', processedFile, fileName);
    if (opts.folder) {
      formData.append('folder', opts.folder);
    }
    formData.append('fileName', fileName);

    // Through the shared client. It detects a FormData body and leaves the
    // Content-Type unset, because only the platform knows the multipart
    // boundary; setting it by hand produces a body multer cannot parse.
    //
    // The bare fetch this replaces had no timeout, so a stalled upload hung
    // until the browser gave up. 60s is an explicit bound chosen for the 5 MB
    // server cap on a slow connection, rather than the 15s default that would
    // fail a legitimate upload.
    const { data: uploaded, error: uploadError } = await apiPost<{ url?: string }>(
      '/api/storage/upload',
      formData,
      { timeoutMs: 60_000 },
    );

    if (uploadError) {
      return {
        success: false,
        error:
          uploadError.status === 401
            ? 'Unauthorized. Please sign in again.'
            : uploadError.message || 'Upload failed',
      };
    }

    const url: string | undefined = uploaded?.url;
    if (!url) {
      return { success: false, error: 'Upload succeeded but no URL was returned' };
    }

    return { success: true, url };
  } catch (error) {
    console.error('Image upload error:', error);
    return {
      success: false,
      error: 'An unexpected error occurred during upload.'
    };
  }
};

/**
 * Extracts the blob name (path within the container) from an Azure Blob
 * public URL. Returns null if the URL doesn't look like an event-invites URL.
 */
function extractBlobNameFromUrl(url: string, container: string): string | null {
  try {
    const parsed = new URL(url);
    // Expected path: /<container>/<blobName>
    const prefix = `/${container}/`;
    const idx = parsed.pathname.indexOf(prefix);
    if (idx === -1) return null;
    return decodeURIComponent(parsed.pathname.slice(idx + prefix.length));
  } catch {
    return null;
  }
}

/**
 * Deletes an image from Azure Blob Storage (via the API).
 *
 * Accepts either a full public URL (the container path is parsed out) or a
 * bare blob name. The `bucket` option is kept for backwards-compatibility and
 * used as the container name when parsing a URL.
 */
export const deleteImage = async (
  url: string,
  bucket: string = 'event-invites'
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Determine the blob name: either parse it from a URL or use the input
    // directly if it's already a bare path.
    let blobName = extractBlobNameFromUrl(url, bucket);
    if (!blobName) {
      // Fall back to treating the input as a blob name (it may already be one).
      blobName = url;
    }

    const { error: deleteError } = await apiDelete(
      `/api/storage/${encodeURIComponent(blobName)}`,
    );

    if (deleteError) {
      return {
        success: false,
        error:
          deleteError.status === 401
            ? 'Unauthorized. Please sign in again.'
            : deleteError.message || 'Delete failed',
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Image delete error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
};

/**
 * Gets a temporary SAS URL for a private blob (via the API). For the public
 * `event-invites` container the public URL is sufficient, but this is provided
 * for future private containers.
 */
export const getBlobSasUrl = async (
  blobNameOrUrl: string,
  bucket: string = 'event-invites'
): Promise<ImageUploadResult> => {
  try {
    let blobName = extractBlobNameFromUrl(blobNameOrUrl, bucket);
    if (!blobName) {
      blobName = blobNameOrUrl;
    }

    const { data, error: sasError } = await apiGet<{ url?: string }>(
      `/api/storage/url/${encodeURIComponent(blobName)}`,
    );

    if (sasError) {
      return { success: false, error: sasError.message || 'Failed to get SAS URL' };
    }

    return { success: true, url: data?.url };
  } catch (error) {
    console.error('Image SAS URL error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
};

/**
 * Gets optimized image URL with transformations (if supported by storage provider)
 */
export const getOptimizedImageUrl = (
  originalUrl: string,
  _options: {
    width?: number;
    height?: number;
    quality?: number;
    format?: 'webp' | 'jpg' | 'png';
  } = {}
): string => {
  // Azure Blob Storage performs no image transformation, so there is nothing
  // to encode into the URL. Returning it unchanged is the honest answer: a
  // width parameter that silently does nothing is worse than none at all.
  // Resizing would need Azure CDN image transforms or a resize endpoint.
  return originalUrl;
};

/**
 * Email-optimized image URL for maximum compatibility
 */
export const getEmailOptimizedImageUrl = (originalUrl: string): string => {
  return getOptimizedImageUrl(originalUrl, {
    width: 600, // Email-safe width
    quality: 80, // Good balance of quality/size for email
    format: 'jpg' // Best email client compatibility
  });
};
