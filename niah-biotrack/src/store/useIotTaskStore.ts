import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { apiFetch } from '../api/client';

export type IotTaskSeverity =
  | 'critical'
  | 'high'
  | 'warning'
  | string;

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

  resolveTask: (
    taskId: string,
    resolutionNotes: string
  ) => Promise<void>;

  clearTasks: () => Promise<void>;
}

const CACHE_KEY = 'niah-assigned-iot-tasks';
const MAX_PAGES = 1000;

function message(error: unknown): string {
  return error instanceof Error &&
    error.message.trim()
    ? error.message
    : 'Could not download assigned tasks.';
}

function validCache(
  value: unknown
): value is TaskCache {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const cache = value as Partial<TaskCache>;

  return (
    Array.isArray(cache.tasks) &&
    Array.isArray(cache.stations) &&
    (cache.updatedAt === null ||
      typeof cache.updatedAt === 'string')
  );
}

async function readCache(): Promise<TaskCache> {
  const raw =
    await AsyncStorage.getItem(CACHE_KEY);

  if (!raw) {
    return {
      tasks: [],
      stations: [],
      updatedAt: null,
    };
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return validCache(parsed)
      ? parsed
      : {
          tasks: [],
          stations: [],
          updatedAt: null,
        };
  } catch {
    return {
      tasks: [],
      stations: [],
      updatedAt: null,
    };
  }
}

async function writeCache(
  cache: TaskCache
): Promise<void> {
  await AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify(cache)
  );
}

async function downloadTasks(): Promise<
  AssignedIotTask[]
> {
  const tasks: AssignedIotTask[] = [];

  for (
    let page = 1;
    page <= MAX_PAGES;
    page += 1
  ) {
    const result = await apiFetch<TaskPage>(
      `/api/iot-workspace/alerts?status=acknowledged&page=${page}`
    );

    if (
      !Array.isArray(result.data) ||
      typeof result.has_more !== 'boolean'
    ) {
      throw new Error(
        'The server returned an invalid assigned-task response.'
      );
    }

    tasks.push(...result.data);

    if (!result.has_more) {
      return tasks;
    }
  }

  throw new Error(
    'The assigned-task list is too large to download safely.'
  );
}

export const useIotTaskStore =
  create<IotTaskState>()((set, get) => ({
    tasks: [],
    stations: [],
    updatedAt: null,

    hydrated: false,
    refreshing: false,
    error: null,

    hydrateTasks: async () => {
      if (get().hydrated) {
        return;
      }

      const cache = await readCache();

      set({
        ...cache,
        hydrated: true,
      });
    },

    refreshAssignedTasks: async () => {
      set({
        refreshing: true,
        error: null,
      });

      try {
        const tasks =
          await downloadTasks();

        let stations =
          get().stations;

        try {
          const result =
            await apiFetch<StationResponse>(
              '/api/iot-workspace/alert-stations'
            );

          if (Array.isArray(result.data)) {
            stations = result.data;
          }
        } catch {
          // Task delivery is more important.
          // Keep cached station names if this
          // optional request fails.
        }

        const cache: TaskCache = {
          tasks,
          stations,
          updatedAt:
            new Date().toISOString(),
        };

        await writeCache(cache);

        set({
          ...cache,
          hydrated: true,
          refreshing: false,
          error: null,
        });

        return tasks.length;
      } catch (error) {
        set({
          refreshing: false,
          error: message(error),
          hydrated: true,
        });

        throw error;
      }
    },

    resolveTask: async (
      taskId,
      resolutionNotes
    ) => {
      const task =
        get().tasks.find(
          (item) => item.id === taskId
        );

      if (!task) {
        throw new Error(
          'This assigned task is no longer available.'
        );
      }

      const notes =
        resolutionNotes.trim();

      if (!notes) {
        throw new Error(
          'Enter resolution notes before resolving the task.'
        );
      }

      /*
       * Backend performs the permission check:
       * only the assigned botanist can resolve it.
       *
       * expected_assigned_at also protects us from
       * resolving a stale task that was reassigned.
       */
      await apiFetch<{
        data: unknown;
      }>(
        `/api/iot-workspace/alerts/${task.id}/resolve`,
        {
          method: 'PATCH',
          body: {
            resolution_notes: notes,
            expected_assigned_at:
              task.assigned_at,
          },
        }
      );

      /*
       * The server has successfully resolved it.
       * Remove it from the cached active-task list
       * immediately.
       */
      const cache: TaskCache = {
        tasks: get().tasks.filter(
          (item) =>
            item.id !== task.id
        ),
        stations: get().stations,
        updatedAt:
          new Date().toISOString(),
      };

      await writeCache(cache);

      set({
        ...cache,
        error: null,
      });

      /*
       * Confirm the latest server state.
       * If this secondary refresh fails, keep the
       * already-correct local result because the
       * PATCH above succeeded.
       */
      try {
        await get().refreshAssignedTasks();
      } catch {
        // Keep resolved task removed locally.
      }
    },

    clearTasks: async () => {
      await AsyncStorage.removeItem(
        CACHE_KEY
      );

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