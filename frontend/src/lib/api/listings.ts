import { supabase } from '@/lib/supabase';

export interface CreateListingDraft {
  title: string;
  description?: string;
  category_id: string;
  condition: string;
  reserve_price_cents: number;
  currency: 'CAD' | 'USD';
  country: string;
  region: string;
  city: string;
  postal_fsa?: string;
}

export interface UpdateListingDraft extends CreateListingDraft {
  id: string;
  media?: any[];
}

export interface PublishListing extends UpdateListingDraft {
  media: any[];
}

export const listingsApi = {
  async createDraft(data: CreateListingDraft) {
    const payload = {
      title: data.title,
      description: data.description || '',
      category_id: data.category_id,
      condition: data.condition,
      reserve_price_cents: data.reserve_price_cents,
      currency: data.currency,
      country: data.country,
      region: data.region,
      city: data.city,
      postal_fsa: data.postal_fsa || '',
    };
    
    console.log('Creating draft with data:', payload);
    const { data: result, error } = await supabase.functions.invoke('listings/draft', {
      body: payload,
    });

    if (error) {
      console.error('Create draft error:', error);
      throw error;
    }
    return result;
  },

  async updateDraft(data: UpdateListingDraft) {
    const payload = {
      id: data.id,
      title: data.title,
      description: data.description || '',
      category_id: data.category_id,
      condition: data.condition,
      reserve_price_cents: data.reserve_price_cents,
      currency: data.currency,
      country: data.country,
      region: data.region,
      city: data.city,
      postal_fsa: data.postal_fsa || '',
      media: data.media || [],
    };
    
    console.log('Updating draft with data:', payload);
    const { data: result, error } = await supabase.functions.invoke('listings/draft', {
      body: payload,
      method: 'PUT',
    });

    if (error) {
      console.error('Update draft error:', error);
      throw error;
    }
    return result;
  },

  async getDraft(id: string) {
    const { error: invokeError } = await supabase.functions.invoke(`listings`, {
      method: 'GET',
    });

    if (invokeError) throw invokeError;
    
    const { data, error: fetchError } = await supabase
      .from('listings')
      .select('*, listing_media(*)')
      .eq('id', id)
      .single();
    
    if (fetchError) throw fetchError;
    return data;
  },

  async publish(data: PublishListing) {
    const { data: result, error } = await supabase.functions.invoke('listings/publish', {
      body: {
        id: data.id,
        title: data.title,
        description: data.description,
        category_id: data.category_id,
        condition: data.condition,
        reserve_price_cents: data.reserve_price_cents,
        currency: data.currency,
        country: data.country,
        region: data.region,
        city: data.city,
        postal_fsa: data.postal_fsa,
        media: data.media,
      },
    });

    if (error) throw error;
    return result;
  },

  async delete(id: string) {
    const { data: result, error } = await supabase.functions.invoke(`listings/${id}`, {
      method: 'DELETE',
    });

    if (error) throw error;
    return result;
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('listings')
      .select('*, listing_media(*), users!seller_id(id, display_name, photo_url, seller_tier)')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  async getMyListings() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('listings')
      .select('*, listing_media(*)')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  async search(params: {
    query?: string;
    category_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = supabase
      .from('listings')
      .select('*, listing_media(*), users!seller_id(id, display_name, photo_url)', { count: 'exact' });

    if (params.query) {
      query = query.or(`title.ilike.%${params.query}%,description.ilike.%${params.query}%`);
    }

    if (params.category_id) {
      query = query.eq('category_id', params.category_id);
    }

    if (params.status) {
      query = query.eq('status', params.status as 'DRAFT' | 'ACTIVE' | 'CANCELLED' | 'PENDING_REVIEW' | 'SOLD' | 'REMOVED');
    } else {
      query = query.eq('status', 'ACTIVE');
    }

    query = query
      .order('created_at', { ascending: false })
      .range(params.offset || 0, (params.offset || 0) + (params.limit || 20) - 1);

    const { data, error, count } = await query;

    if (error) throw error;
    return { data, count };
  },
};
