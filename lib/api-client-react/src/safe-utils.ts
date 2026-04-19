/**
 * Utility functions for safe data extraction and validation
 * Prevents crashes from malformed or missing data
 */

export function safeString(value: unknown, maxLength = 500): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.slice(0, maxLength);
  }
  return String(value).slice(0, maxLength);
}

export function safeArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value;
  return [];
}

export function safeObject<T extends Record<string, unknown>>(
  value: unknown,
): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as T;
  }
  return {} as T;
}

export function safeNumber(value: unknown, defaultValue = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

export function safeId(value: unknown): string | null {
  const str = safeString(value, 100);
  return str ? str : null;
}

/**
 * Sanitize search query to prevent crashes
 * - Max length limit
 * - Remove problematic characters
 * - Trim whitespace
 */
export function sanitizeSearchQuery(query: string, maxLength = 100): string {
  return query
    .trim()
    .slice(0, maxLength)
    .replace(/[\n\r\t]/g, " ") // Remove line breaks and tabs
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

/**
 * Encode URL parameters safely
 * Handles special characters, null values, and length limits
 */
export function encodeUrlParams(
  params: Record<string, unknown>,
): URLSearchParams {
  const encoded = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    try {
      const strValue = String(value).slice(0, 500); // Limit param length
      if (strValue) {
        encoded.append(key, strValue);
      }
    } catch (error) {
      // Skip problematic values
      console.warn(`Failed to encode parameter ${key}:`, error);
    }
  });

  return encoded;
}

/**
 * Check if search query is valid and not empty
 */
export function isValidSearchQuery(query: unknown): boolean {
  if (typeof query !== "string") return false;
  return sanitizeSearchQuery(query).length > 1;
}
