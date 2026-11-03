import Constants from 'expo-constants';

// Extracts the IP address of the machine running Metro bundler
const getApiBaseUrl = (): string => {
  // If explicitly specified in .env, use it
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL.trim().replace(/\/+$/, '');
  }

  // Otherwise, automatically derive it from Expo's Metro host URI
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    return `http://${ip}:3000`;
  }

  return 'http://localhost:3000';
};

export const API_BASE_URL = getApiBaseUrl();