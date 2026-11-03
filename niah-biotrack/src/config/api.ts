export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || 'https://niah-backend.onrender.com'
)
  .trim()
  .replace(/\/+$/, '');