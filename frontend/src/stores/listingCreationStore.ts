import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { listingsApi } from '../lib/api/listings';

export interface ListingMedia {
  id?: string;
  file?: File;
  type: 'IMAGE' | 'VIDEO';
  s3_key?: string;
  s3_bucket?: string;
  url?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  size_bytes: number;
  sort_order: number;
  uploading?: boolean;
  uploadProgress?: number;
  error?: string;
}

export interface ListingDraft {
  id?: string;
  title: string;
  description: string;
  category_id: string | null;
  condition: string | null;
  reserve_price_cents: number;
  currency: 'CAD' | 'USD';
  country: string;
  region: string;
  city: string;
  postal_fsa: string;
  media: ListingMedia[];
  current_step: number;
  last_saved_at?: string;
}

interface ListingCreationState {
  draft: ListingDraft;
  isDirty: boolean;
  isSaving: boolean;
  lastError: string | null;
  
  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  setCategory: (category_id: string) => void;
  setCondition: (condition: string) => void;
  setReservePrice: (price_cents: number) => void;
  setCurrency: (currency: 'CAD' | 'USD') => void;
  setLocation: (country: string, region: string, city: string, postal_fsa?: string) => void;
  addMedia: (media: ListingMedia) => void;
  removeMedia: (index: number) => void;
  reorderMedia: (fromIndex: number, toIndex: number) => void;
  updateMedia: (index: number, updates: Partial<ListingMedia>) => void;
  setCurrentStep: (step: number) => void;
  
  saveDraft: () => Promise<void>;
  loadDraft: (id: string) => Promise<void>;
  publishListing: () => Promise<string>;
  resetDraft: () => void;
}

const initialDraft: ListingDraft = {
  title: '',
  description: '',
  category_id: null,
  condition: null,
  reserve_price_cents: 0,
  currency: 'CAD',
  country: 'CA',
  region: '',
  city: '',
  postal_fsa: '',
  media: [],
  current_step: 0,
};

export const useListingCreation = create<ListingCreationState>()(
  persist(
    (set, get) => ({
      draft: initialDraft,
      isDirty: false,
      isSaving: false,
      lastError: null,

      setTitle: (title) => set({ draft: { ...get().draft, title }, isDirty: true }),
      setDescription: (description) => set({ draft: { ...get().draft, description }, isDirty: true }),
      setCategory: (category_id) => set({ draft: { ...get().draft, category_id }, isDirty: true }),
      setCondition: (condition) => set({ draft: { ...get().draft, condition }, isDirty: true }),
      setReservePrice: (reserve_price_cents) => set({ draft: { ...get().draft, reserve_price_cents }, isDirty: true }),
      setCurrency: (currency) => set({ draft: { ...get().draft, currency }, isDirty: true }),
      setLocation: (country, region, city, postal_fsa = '') => 
        set({ draft: { ...get().draft, country, region, city, postal_fsa }, isDirty: true }),
      
      addMedia: (media) => {
        const currentMedia = get().draft.media;
        const newMedia = [...currentMedia, { ...media, sort_order: currentMedia.length }];
        set({ draft: { ...get().draft, media: newMedia }, isDirty: true });
      },
      
      removeMedia: (index) => {
        const newMedia = get().draft.media.filter((_, i) => i !== index)
          .map((m, i) => ({ ...m, sort_order: i }));
        set({ draft: { ...get().draft, media: newMedia }, isDirty: true });
      },
      
      reorderMedia: (fromIndex, toIndex) => {
        const media = [...get().draft.media];
        const [removed] = media.splice(fromIndex, 1);
        media.splice(toIndex, 0, removed);
        const reordered = media.map((m, i) => ({ ...m, sort_order: i }));
        set({ draft: { ...get().draft, media: reordered }, isDirty: true });
      },
      
      updateMedia: (index, updates) => {
        const media = [...get().draft.media];
        media[index] = { ...media[index], ...updates };
        set({ draft: { ...get().draft, media }, isDirty: true });
      },
      
      setCurrentStep: (current_step) => set({ draft: { ...get().draft, current_step } }),

      saveDraft: async () => {
        set({ isSaving: true, lastError: null });
        try {
          const { draft } = get();
          
          const payload = {
            id: draft.id,
            title: draft.title,
            description: draft.description,
            category_id: draft.category_id!,
            condition: draft.condition!,
            reserve_price_cents: draft.reserve_price_cents,
            currency: draft.currency,
            country: draft.country,
            region: draft.region,
            city: draft.city,
            postal_fsa: draft.postal_fsa,
            media: draft.media.filter(m => m.s3_key && m.url),
          };

          console.log('Saving draft:', payload);

          const saved = draft.id 
            ? await listingsApi.updateDraft(payload)
            : await listingsApi.createDraft(payload);
          
          console.log('Draft saved:', saved);
          
          set({ 
            draft: { ...draft, id: saved.id, last_saved_at: new Date().toISOString() },
            isDirty: false,
            isSaving: false,
          });
        } catch (error: any) {
          console.error('Save draft error:', error);
          set({ lastError: error.message, isSaving: false });
          throw error;
        }
      },

      loadDraft: async (id) => {
        set({ isSaving: true, lastError: null });
        try {
          const draft = await listingsApi.getDraft(id);
          set({ 
            draft: {
              ...draft,
              media: draft.listing_media || [],
              current_step: 0,
            }, 
            isDirty: false, 
            isSaving: false 
          });
        } catch (error: any) {
          console.error('Load draft error:', error);
          set({ lastError: error.message, isSaving: false });
        }
      },

      publishListing: async () => {
        set({ isSaving: true, lastError: null });
        try {
          const { draft } = get();
          
          if (!draft.title || !draft.category_id || !draft.condition || !draft.country || !draft.region || !draft.city) {
            throw new Error('Missing required fields');
          }

          if (draft.media.filter(m => m.s3_key && m.url).length === 0) {
            throw new Error('At least one photo is required');
          }
          
          const result = await listingsApi.publish({
            id: draft.id,
            title: draft.title,
            description: draft.description,
            category_id: draft.category_id,
            condition: draft.condition,
            reserve_price_cents: draft.reserve_price_cents,
            currency: draft.currency,
            country: draft.country,
            region: draft.region,
            city: draft.city,
            postal_fsa: draft.postal_fsa,
            media: draft.media.filter(m => m.s3_key && m.url),
          });
          
          set({ draft: initialDraft, isDirty: false, isSaving: false });
          return result.id;
        } catch (error: any) {
          console.error('Publish listing error:', error);
          set({ lastError: error.message, isSaving: false });
          throw error;
        }
      },

      resetDraft: () => set({ draft: initialDraft, isDirty: false, lastError: null }),
    }),
    {
      name: 'listing-creation-storage',
      partialize: (state) => ({ draft: state.draft }),
    }
  )
);
