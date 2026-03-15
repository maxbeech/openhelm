import { create } from "zustand";
import type { Job, CreateJobParams, UpdateJobParams } from "@openorchestra/shared";
import * as api from "@/lib/api";
import { friendlyError } from "@/lib/utils";

interface JobState {
  jobs: Job[];
  loading: boolean;
  error: string | null;

  fetchJobs: (projectId: string | null) => Promise<void>;
  createJob: (params: CreateJobParams) => Promise<Job>;
  updateJob: (params: UpdateJobParams) => Promise<Job>;
  toggleEnabled: (id: string, isEnabled: boolean) => Promise<void>;
  archiveJob: (id: string) => Promise<void>;
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
      const jobs = await api.listJobs(projectId ? { projectId } : undefined);
      set({ jobs, loading: false });
    } catch (err) {
      set({
        error: friendlyError(err, "Failed to load jobs"),
        loading: false,
      });
    }
  },

  updateJob: async (params) => {
    try {
      const updated = await api.updateJob(params);
      set((s) => ({
        jobs: s.jobs.map((j) => (j.id === params.id ? updated : j)),
      }));
      return updated;
    } catch (err) {
      set({ error: friendlyError(err, "Failed to update job") });
      throw err;
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

  archiveJob: async (id) => {
    try {
      const updated = await api.archiveJob(id);
      set((s) => ({
        jobs: s.jobs.map((j) => (j.id === id ? updated : j)),
      }));
    } catch (err) {
      set({ error: friendlyError(err, "Failed to archive job") });
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
