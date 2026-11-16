function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

export const API_BASE_URL = trimTrailingSlashes((
  process.env.EXPO_PUBLIC_API_BASE_URL || 'https://niah-backend.onrender.com'
)
  .trim());