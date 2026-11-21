import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { apiFetch } from '../api/client';

export type IotTaskSeverity = 'critical' | 'high' | 'warning' | string;

export interface AssignedIotTask {
  id: string;
  station_id: string;
  reading_id: string | null;
  alert_message: string;
  severity: IotTaskSeverity;
  alert_status: 'acknowledged';
  triggered_at: string;
  assigned_to: string;
  assigned_by: string | null;
  assigned_at: string;
  assignment_notes: string | null;
}

export interface IotTaskStation {
  id: string;
  station_code: string;
}

interface TaskPage {
  data: AssignedIotTask[];
  has_more: boolean;
  page: number;
}

interface StationResponse {
  data: IotTaskStation[];
}

interface TaskCache {
  tasks: AssignedIotTask[];
  stations: IotTaskStation[];
  updatedAt: string | null;
}

interface IotTaskState extends TaskCache {
  hydrated: boolean;
  refreshing: boolean;
  error: string | null;
  hydrateTasks: () => Promise<void>;
  refreshAssignedTasks: () => Promise<number>;
  clearTasks: () => Promise<void>;
}

const CACHE_KEY = 'niah-assigned-iot-tasks';
const MAX_PAGES = 1000;

function message(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Could not download assigned tasks.';
}

function validCache(value: unknown): value is TaskCache {
  if (!value || typeof value !== 'object') return false;
  const cache = value as Partial<TaskCache>;
  return Array.isArray(cache.tasks) && Array.isArray(cache.stations) &&
    (cache.updatedAt === null || typeof cache.updatedAt === 'string');
}

async function readCache(): Promise<TaskCache> {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return { tasks: [], stations: [], updatedAt: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    return validCache(parsed) ? parsed : { tasks: [], stations: [], updatedAt: null };
  } catch {
    return { tasks: [], stations: [], updatedAt: null };
  }
}

async function downloadTasks(): Promise<AssignedIotTask[]> {
  const tasks: AssignedIotTask[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await apiFetch<TaskPage>(
      `/api/iot-workspace/alerts?status=acknowledged&page=${page}`
    );
    if (!Array.isArray(result.data) || typeof result.has_more !== 'boolean') {
      throw new Error('The server returned an invalid assigned-task response.');
    }
    tasks.push(...result.data);
    if (!result.has_more) return tasks;
  }
  throw new Error('The assigned-task list is too large to download safely.');
}

export const useIotTaskStore = create<IotTaskState>()((set, get) => ({
  tasks: [],
  stations: [],
  updatedAt: null,
  hydrated: false,
  refreshing: false,
  error: null,

  hydrateTasks: async () => {
    if (get().hydrated) return;
    const cache = await readCache();
    set({ ...cache, hydrated: true });
  },

  refreshAssignedTasks: async () => {
    set({ refreshing: true, error: null });
    try {
      const tasks = await downloadTasks();
      let stations = get().stations;
      try {
        const result = await apiFetch<StationResponse>('/api/iot-workspace/alert-stations');
        if (Array.isArray(result.data)) stations = result.data;
      } catch {
        // Task delivery is the required operation. Keep cached station names if
        // the optional label lookup is temporarily unavailable.
      }
      const cache: TaskCache = {
        tasks,
        stations,
        updatedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      set({ ...cache, hydrated: true, refreshing: false, error: null });
      return tasks.length;
    } catch (error) {
      set({ refreshing: false, error: message(error), hydrated: true });
      throw error;
    }
  },

  clearTasks: async () => {
    await AsyncStorage.removeItem(CACHE_KEY);
    set({
      tasks: [],
      stations: [],
      updatedAt: null,
      hydrated: true,
      refreshing: false,
      error: null,
    });
  },
}));
