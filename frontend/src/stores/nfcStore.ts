import { create } from 'zustand';
import { api } from '@/lib/api';
import type { NfcTag, NfcTagDetail } from '@/features/verification/types/nfc';

interface NfcState {
  tags: NfcTag[];
  selectedTag: NfcTagDetail | null;
  loading: boolean;
  error: string | null;

  fetchTags: () => Promise<void>;
  fetchTagDetail: (tagId: string) => Promise<void>;
  registerTag: (input: { tagUid: string; aesKey: string; itemId?: string }) => Promise<NfcTag>;
  transferTag: (input: { tagId: string; toUserId: string; transferType: string; transactionId?: string }) => Promise<void>;
  clearSelected: () => void;
}

export const useNfcStore = create<NfcState>()((set, get) => ({
  tags: [],
  selectedTag: null,
  loading: false,
  error: null,

  fetchTags: async () => {
    set({ loading: true, error: null });
    try {
      const tags = await api.nfcGetTags();
      set({ tags, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch tags', loading: false });
    }
  },

  fetchTagDetail: async (tagId: string) => {
    set({ loading: true, error: null });
    try {
      const detail = await api.nfcGetTag(tagId);
      set({ selectedTag: detail, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch tag detail', loading: false });
    }
  },

  registerTag: async (input) => {
    set({ loading: true, error: null });
    try {
      const tag = await api.nfcRegister(input);
      set({ tags: [...get().tags, tag], loading: false });
      return tag;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to register tag';
      set({ error: msg, loading: false });
      throw error;
    }
  },

  transferTag: async (input) => {
    set({ loading: true, error: null });
    try {
      await api.nfcTransfer(input);
      // Remove transferred tag from list
      set({ tags: get().tags.filter((t) => t.id !== input.tagId), loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to transfer tag', loading: false });
      throw error;
    }
  },

  clearSelected: () => set({ selectedTag: null }),
}));
