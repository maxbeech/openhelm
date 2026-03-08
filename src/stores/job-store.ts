import { create } from "zustand";
import type { Job, CreateJobParams } from "@openorchestra/shared";
import * as api from "@/lib/api";
import { friendlyError } from "@/lib/utils";

interface JobState {
  jobs: Job[];
  loading: boolean;
  error: string | null;

  fetchJobs: (projectId: string) => Promise<void>;
  createJob: (params: CreateJobParams) => Promise<Job>;
  toggleEnabled: (id: string, isEnabled: boolean) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  updateJobInStore: (job: Job) => void;
}

export const useJobStore = create<JobState>((set) => ({
  jobs: [],
  loading: false,
  error: null,

  createJob: async (params) => {
    try {
      const job = await api.createJob(params);
      set((s) => ({ jobs: [job, ...s.jobs] }));
      return job;
    } catch (err) {
      set({ error: friendlyError(err, "Failed to create job") });
      throw err;
    }
  },

  fetchJobs: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const jobs = await api.listJobs({ projectId });
      set({ jobs, loading: false });
    } catch (err) {
      set({
        error: friendlyError(err, "Failed to load jobs"),
        loading: false,
      });
    }
  },

  toggleEnabled: async (id, isEnabled) => {
    try {
      const updated = await api.updateJob({ id, isEnabled });
      set((s) => ({
        jobs: s.jobs.map((j) => (j.id === id ? updated : j)),
      }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to toggle job") });
      throw err;
    }
  },

  deleteJob: async (id) => {
    try {
      await api.deleteJob(id);
      set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to delete job") });
      throw err;
    }
  },

  updateJobInStore: (job) => {
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === job.id ? job : j)),
    }));
  },
}));
