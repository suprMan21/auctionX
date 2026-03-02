import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      throw new Error('Unauthorized');
    }

    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method;

    if (pathname.includes('/draft') && method === 'POST') {
      return await createDraft(supabaseClient, user.id, req);
    }

    if (pathname.includes('/draft') && method === 'PUT') {
      return await updateDraft(supabaseClient, user.id, req);
    }

    if (pathname.match(/\/draft\/[^/]+$/) && method === 'GET') {
      const listingId = pathname.split('/').pop();
      return await getDraft(supabaseClient, user.id, listingId!);
    }

    if (pathname.includes('/publish') && method === 'POST') {
      return await publishListing(supabaseClient, user.id, req);
    }

    if (pathname.match(/\/[^/]+$/) && method === 'DELETE') {
      const listingId = pathname.split('/').pop();
      return await deleteListing(supabaseClient, user.id, listingId!);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status || 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function createDraft(supabase: any, userId: string, req: Request) {
  try {
    const body = await req.json();
    console.log('Create draft request body:', body);
    
    const { title, description, category_id, condition, reserve_price_cents, currency, country, region, city } = body;

    const { data, error } = await supabase
      .from('listings')
      .insert({
        seller_id: userId,
        title,
        description,
        category_id,
        condition,
        reserve_price_cents,
        currency,
        location_country: country,
        location_region: region,
        location_city: city,
        status: 'DRAFT',
        brand: 'AUCTIONX',
      })
      .select()
      .single();

    if (error) {
      console.error('Database insert error:', error);
      throw error;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('createDraft error:', error);
    return new Response(JSON.stringify({ error: error.message, details: error }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function updateDraft(supabase: any, userId: string, req: Request) {
  const body = await req.json();
  const { id, title, description, category_id, condition, reserve_price_cents, currency, country, region, city, media } = body;

  const { data: listing, error: updateError } = await supabase
    .from('listings')
    .update({
      title,
      description,
      category_id,
      condition,
      reserve_price_cents,
      currency,
      location_country: country,
      location_region: region,
      location_city: city,
    })
    .eq('id', id)
    .eq('seller_id', userId)
    .select()
    .single();

  if (updateError) throw updateError;

  if (media && media.length > 0) {
    await supabase
      .from('listing_media')
      .delete()
      .eq('listing_id', id);

    const mediaInserts = media.map((m: any) => ({
      listing_id: id,
      type: m.type,
      s3_key: m.s3_key,
      s3_bucket: m.s3_bucket,
      url: m.url,
      thumbnail_url: m.thumbnail_url,
      width: m.width,
      height: m.height,
      duration_seconds: m.duration_seconds,
      size_bytes: m.size_bytes,
      sort_order: m.sort_order,
    }));

    await supabase.from('listing_media').insert(mediaInserts);
  }

  return new Response(JSON.stringify(listing), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getDraft(supabase: any, userId: string, listingId: string) {
  const { data, error } = await supabase
    .from('listings')
    .select('*, listing_media(*)')
    .eq('id', listingId)
    .eq('seller_id', userId)
    .single();

  if (error) throw error;

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function publishListing(supabase: any, userId: string, req: Request) {
  const body = await req.json();
  const { id, media } = body;

  if (!media || media.length === 0) {
    throw new Error('At least one photo is required');
  }

  const { data, error } = await supabase
    .from('listings')
    .update({ status: 'ACTIVE' })
    .eq('id', id)
    .eq('seller_id', userId)
    .select()
    .single();

  if (error) throw error;

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function deleteListing(supabase: any, userId: string, listingId: string) {
  const { error } = await supabase
    .from('listings')
    .delete()
    .eq('id', listingId)
    .eq('seller_id', userId);

  if (error) throw error;

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
